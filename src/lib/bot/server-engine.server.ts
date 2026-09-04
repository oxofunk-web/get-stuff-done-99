/**
 * Server-side bot runner.
 *
 * The dashboard bot only trades while a browser tab is awake; a locked phone
 * suspends it. This module runs on a scheduled tick instead: it samples the
 * same feeds (Coinbase BRTI spot + Kalshi books), records the tape, reuses
 * the exact signal math the dashboard uses, and — only when explicitly
 * enabled in `bot_settings` — places up to `max_trades` orders per candle.
 *
 * Tape recording happens on every tick (it feeds the replay/tuning pipeline).
 * Trading is LIVE ONLY: there is no paper path — a signal either becomes a real
 * Kalshi order or a recorded reason why it did not. The single ON/OFF switch in
 * `bot_settings.enabled` arms real money immediately. All durable state lives in
 * Supabase — workers are stateless, so nothing important is kept in module
 * memory. Filled positions are managed every tick: take profit, stop out, or
 * let them settle.
 */
import { emptyTable, type PairCalibration } from "./calibration";
import { candleInfo } from "./candle";
import {
  CLOSE_SECS,
  DAILY_LOSS_CAP_DEFAULT,
  GATE_SECS,
  MAX_SLIPPAGE_CENTS,
  MAX_SPREAD,
  MAX_YES_MID,
  MIN_RESTING_DEPTH,
  MIN_SIGMA_DIST,
  MIN_SKEW,
  MIN_YES_MID,
  PAIRS,
  THRESHOLD,
  type PairId,
} from "./constants";
import { computeSignals, getSignalTrace, setCalibration } from "./signals";
import { dropVetoed, rankSignals, setPairEdge } from "./ranking";
import type { PairEdgeRow } from "./telemetry.functions";
import { resetTuning, setTuning } from "./tuning";
import { restingDepth } from "./order-map";
import { fetchLiveBalance, fetchOpenMarket, normalizeMarket, placeLiveOrder } from "../kalshi.server";
import type { KalshiMarket, SpotState, SpotTick } from "./types";

/**
 * Sampling. The momentum math needs ~24 ticks inside a candle, so one sample
 * per minute is far too thin when the dashboard isn't also feeding the tape.
 * Each tick therefore samples continuously for most of its minute, re-scoring
 * the engine after every sample — that gives the server the same
 * many-chances-per-candle view the dashboard has instead of a single look.
 */
const SAMPLE_GAP_MS = 2500;
/** Time budget per tick — under a minute so consecutive cron ticks never overlap. */
const TICK_BUDGET_MS = 22_000;
/** Lease is longer than the work budget, but shorter than the next cron wake-up. */
const RUN_LEASE_SECONDS = 50;
/** Fallback exit thresholds, in cents, when settings are unreadable. */
const TAPE_RETENTION_MS = 7 * 24 * 3600 * 1000;


export interface ServerBotRow {
  id: boolean;
  enabled: boolean;
  /** Pinned to "live" — paper mode no longer exists. */
  mode: "live";
  bet_size: number;
  ev_margin: number;
  max_trades: number;
  first_enabled_at: string | null;
  live_confirmed_at: string | null;
  last_tick_at: string | null;
  last_tick_msg: string | null;
  daily_loss_cap: number;
  /** Signal gates, tunable from the dashboard. */
  threshold?: number | null;
  min_yes_mid?: number | null;
  max_yes_mid?: number | null;
  min_skew?: number | null;
  max_spread?: number | null;
  min_sigma_dist?: number | null;
  gate_preset?: string | null;
  run_lease_id?: string | null;
  run_lease_until?: string | null;
}

type Db = Awaited<ReturnType<typeof admin>>;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function loadSettings(db: Db): Promise<ServerBotRow> {
  const { data } = await db.from("bot_settings").select("*").eq("id", true).maybeSingle();
  if (data) return data as unknown as ServerBotRow;
  const fallback: ServerBotRow = {
    id: true,
    enabled: false,
    mode: "live",
    bet_size: 5,
    ev_margin: 0.08,
    max_trades: 4,
    first_enabled_at: null,
    live_confirmed_at: null,
    last_tick_at: null,
    last_tick_msg: null,
    daily_loss_cap: DAILY_LOSS_CAP_DEFAULT,
  };
  const { data: inserted } = await db
    .from("bot_settings")
    .insert({ id: true })
    .select("*")
    .maybeSingle();
  return (inserted as unknown as ServerBotRow | null) ?? fallback;
}


export interface ServerBotState {
  ok: boolean;
  enabled: boolean;
  betSize: number;
  evMargin: number;
  maxTrades: number;
  dailyLossCap: number;
  /** Signal gates, as the runner will use them on the next tick. */
  threshold: number;
  minYesMid: number;
  maxYesMid: number;
  minSkew: number;
  maxSpread: number;
  minSigmaDist: number;
  gatePreset: string;
  lastTickAt: string | null;
  lastTickMsg: string | null;
  recentTrades: {
    ts: string;
    candle_id: number;
    pair: string;
    dir: string;
    status: string;
    msg: string | null;
    outcome: string | null;
    pnl: number | null;
  }[];
  /** Newest reason per pair a server-seen signal did NOT become an order. */
  skips: { pair: string; reason: string; ts: string }[];
  /** Newest gate that blocked each pair (rejected OR skipped) on the server. */
  blocks: { pair: string; reason: string; verdict: string; ts: string }[];
  error?: string;
}


export async function getServerBotState(db: Db): Promise<ServerBotState> {
  const s = await loadSettings(db);
  const { data: recent } = await db
    .from("trade_log")
    .select("ts, candle_id, pair, dir, status, msg, outcome, pnl")
    .eq("source", "server")
    .order("ts", { ascending: false })
    .limit(8);
  // Why the server didn't trade: newest decision per pair. Rejections come from
  // the gates, skips from the order path — both matter when nothing fires.
  const { data: decisionRows } = await db
    .from("signal_log")
    .select("ts, pair, reason, verdict")
    .eq("source", "server")
    .in("verdict", ["skipped", "rejected"])
    .order("ts", { ascending: false })
    .limit(200);
  const rows = (decisionRows ?? []) as {
    ts: string;
    pair: string;
    reason: string | null;
    verdict: string;
  }[];
  const seenSkip = new Set<string>();
  const skips: ServerBotState["skips"] = [];
  const seenBlock = new Set<string>();
  const blocks: ServerBotState["blocks"] = [];
  for (const r of rows) {
    if (!seenBlock.has(r.pair)) {
      seenBlock.add(r.pair);
      blocks.push({ pair: r.pair, reason: r.reason ?? r.verdict, verdict: r.verdict, ts: r.ts });
    }
    if (r.verdict === "skipped" && !seenSkip.has(r.pair)) {
      seenSkip.add(r.pair);
      skips.push({ pair: r.pair, reason: r.reason ?? "skipped", ts: r.ts });
    }
  }
  return {
    ok: true,
    enabled: s.enabled,
    betSize: s.bet_size,
    evMargin: s.ev_margin,
    maxTrades: s.max_trades,
    dailyLossCap: s.daily_loss_cap ?? DAILY_LOSS_CAP_DEFAULT,
    threshold: s.threshold ?? THRESHOLD,
    minYesMid: s.min_yes_mid ?? MIN_YES_MID,
    maxYesMid: s.max_yes_mid ?? MAX_YES_MID,
    minSkew: s.min_skew ?? MIN_SKEW,
    maxSpread: s.max_spread ?? MAX_SPREAD,
    minSigmaDist: s.min_sigma_dist ?? MIN_SIGMA_DIST,
    gatePreset: s.gate_preset ?? "balanced",
    lastTickAt: s.last_tick_at,
    lastTickMsg: s.last_tick_msg,
    recentTrades: (recent ?? []) as ServerBotState["recentTrades"],
    skips,
    blocks,
  };
}

/** Coinbase (a BRTI constituent) first; Binance as fallback. */
async function fetchSpots(): Promise<Partial<Record<PairId, number>>> {
  const out: Partial<Record<PairId, number>> = {};
  try {
    await Promise.all(
      PAIRS.map(async (p) => {
        const r = await fetch(`https://api.exchange.coinbase.com/products/${p.id}-USD/ticker`, {
          headers: { accept: "application/json" },
        });
        if (!r.ok) return;
        const j = (await r.json()) as { price?: string };
        const price = Number(j.price ?? 0);
        if (Number.isFinite(price) && price > 0) out[p.id] = price;
      }),
    );
  } catch {
    // partial results are still usable
  }
  if (Object.keys(out).length) return out;
  try {
    await Promise.all(
      PAIRS.map(async (p) => {
        const r = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbol=${p.wsKey.toUpperCase()}`,
          { headers: { accept: "application/json" } },
        );
        if (!r.ok) return;
        const j = (await r.json()) as { price?: string };
        const price = Number(j.price ?? 0);
        if (Number.isFinite(price) && price > 0) out[p.id] = price;
      }),
    );
  } catch {
    // no spot this sample
  }
  return out;
}

async function fetchAllMarkets(
  spots: Partial<Record<PairId, number>> = {},
): Promise<Partial<Record<PairId, KalshiMarket>>> {
  const results = await Promise.all(
    PAIRS.map(async (p) => {
      // One flaky pair must never blank the whole round: a thrown request used
      // to reject the batch, which showed up as "no open market" for all pairs.
      try {
        const raw = await fetchOpenMarket(p.series, spots[p.id] ?? null);
        if (!raw) return null;
        return { pair: p.id, ...normalizeMarket(raw) } as KalshiMarket;
      } catch {
        return null;
      }
    }),
  );
  const out: Partial<Record<PairId, KalshiMarket>> = {};
  for (const m of results) if (m) out[m.pair] = m;
  return out;
}

/** Fresh single-pair quote, used to re-price right before an order goes out. */
async function fetchOneMarket(pair: PairId, spot?: number | null): Promise<KalshiMarket | null> {
  const p = PAIRS.find((x) => x.id === pair);
  if (!p) return null;
  try {
    const raw = await fetchOpenMarket(p.series, spot ?? null);
    if (!raw) return null;
    return { pair: p.id, ...normalizeMarket(raw) } as KalshiMarket;
  } catch {
    return null;
  }
}


/**
 * Calibration from settled signal outcomes — same bands as the client, plus the
 * per-pair split so the server bot weights the pairs that actually win.
 */
async function loadCalibration(db: Db) {
  const table = emptyTable();
  const pairTable: PairCalibration = {};
  const { data } = await db
    .from("signal_log")
    .select("pair, conf, outcome, verdict, entry_price")
    .not("outcome", "is", null)
    .not("conf", "is", null)
    .limit(20000);
  const edge = new Map<string, PairEdgeRow>();
  for (const r of (data ?? []) as {
    pair: string;
    conf: number;
    outcome: string;
    verdict: string;
    entry_price: number | null;
  }[]) {
    const won = r.outcome === "win";
    const band = table.find((b) => r.conf >= b.lo && r.conf < b.hi);
    if (band) {
      band.n += 1;
      if (won) band.wins += 1;
    }
    const e =
      edge.get(r.pair) ??
      { pair: r.pair, n: 0, wins: 0, fired: 0, firedWins: 0, avgEntry: 0, pnl: 0, trades: 0 };
    e.n += 1;
    if (won) e.wins += 1;
    if (r.verdict === "fired") {
      e.fired += 1;
      if (won) e.firedWins += 1;
      if (r.entry_price != null && r.entry_price > 0) {
        // Running mean of entry price = the breakeven win rate this pair pays.
        e.avgEntry = e.avgEntry + (r.entry_price - e.avgEntry) / e.fired;
      }
    }
    edge.set(r.pair, e);

    const pt = (pairTable[r.pair] ??= emptyTable());
    const pband = pt.find((b) => r.conf >= b.lo && r.conf < b.hi);
    if (pband) {
      pband.n += 1;
      if (won) pband.wins += 1;
    }
  }
  return { table, pairTable, pairEdge: [...edge.values()] };
}

interface SnapshotInsert {
  candle_id: number;
  seconds_in: number;
  pair: string;
  ticker: string | null;
  spot: number;
  strike: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  yes_mid: number | null;
  spread: number | null;
  vol: number | null;
}

/** A `signal_log` row written by the server runner (source = "server"). */
interface SignalInsert {
  candle_id: number;
  seconds_in: number;
  pair: string;
  verdict: string;
  reason: string | null;
  source: "server";
  dir?: string | null;
  conf?: number | null;
  calibrated?: number | null;
  entry_price?: number | null;
  ev?: number | null;
  yes_mid?: number | null;
  spread?: number | null;
  skew?: number | null;
  spot_mom?: number | null;
  k_mom?: number | null;
  sigma_dist?: number | null;
  spot?: number | null;
  strike?: number | null;
}





/**
 * One tick = continuous sampling for most of a minute. Every round records the
 * tape, re-scores the engine, and (inside the trade window, when enabled)
 * attempts this candle's orders. Every reason a fired signal did NOT become an
 * order is written to `signal_log` as a `skipped` row, so "good signals but no
 * trades" is never invisible again.
 */
async function runOwnedServerBotTick(db: Db) {
  const startedAt = Date.now();
  const settings = await loadSettings(db);
  const deadline = startedAt + TICK_BUDGET_MS;

  const markets: Partial<Record<PairId, KalshiMarket>> = {};
  /** When each cached quote was observed — stale books must never score. */
  const marketAt: Partial<Record<PairId, number>> = {};
  const latestSpots: Partial<Record<PairId, number>> = {};
  /** A quote older than this is dropped rather than scored. */
  const MAX_QUOTE_AGE_MS = 20_000;

  // Each scheduled run starts with an empty process, so seed the last known book
  // from the recorded tape — but ONLY from this candle and only from the last few
  // seconds. Seeding from a previous candle's market was scoring one candle's
  // book while ordering in the next, which showed up as bogus signals and
  // "quote moved" skips.
  {
    const seedCandle = candleInfo().id;
    const since = new Date(Date.now() - MAX_QUOTE_AGE_MS).toISOString();
    const { data: warm } = await db
      .from("market_snapshots")
      .select("pair, ticker, strike, yes_bid, yes_ask, yes_mid, spread, vol, ts")
      .eq("candle_id", seedCandle)
      .gte("ts", since)
      .not("ticker", "is", null)
      .order("ts", { ascending: true })
      .limit(2000);
    for (const r of (warm ?? []) as {
      pair: string;
      ticker: string | null;
      strike: number | null;
      yes_bid: number | null;
      yes_ask: number | null;
      yes_mid: number | null;
      spread: number | null;
      vol: number | null;
      ts: string;
    }[]) {
      if (!r.ticker || r.yes_bid == null || r.yes_ask == null) continue;
      markets[r.pair as PairId] = {
        pair: r.pair as PairId,
        ticker: r.ticker,
        strike: r.strike ?? 0,
        yesBid: r.yes_bid,
        yesAsk: r.yes_ask,
        yesMid: r.yes_mid ?? (r.yes_bid + r.yes_ask) / 2,
        spread: r.spread ?? r.yes_ask - r.yes_bid,
        vol: r.vol ?? 0,
      } as KalshiMarket;
      marketAt[r.pair as PairId] = new Date(r.ts).getTime();
    }
  }



  const heartbeat = async (msg: string) => {
    await db
      .from("bot_settings")
      .update({ last_tick_at: new Date().toISOString(), last_tick_msg: msg })
      .eq("id", true);
  };

  // ---- Engine inputs that only change per tick ----------------------------
  resetTuning();
  // Every gate the dashboard exposes is applied here, so what you set is
  // literally what the runner filters on (not just the EV margin).
  setTuning({
    evMargin: settings.ev_margin,
    threshold: settings.threshold ?? THRESHOLD,
    minYesMid: settings.min_yes_mid ?? MIN_YES_MID,
    maxYesMid: settings.max_yes_mid ?? MAX_YES_MID,
    minSkew: settings.min_skew ?? MIN_SKEW,
    maxSpread: settings.max_spread ?? MAX_SPREAD,
    minSigmaDist: settings.min_sigma_dist ?? MIN_SIGMA_DIST,
  });
  const cal = await loadCalibration(db);
  setCalibration(cal.table, cal.pairTable);
  setPairEdge(cal.pairEdge);

  const cap = settings.daily_loss_cap ?? DAILY_LOSS_CAP_DEFAULT;

  // Same daily loss cap the dashboard shows: once today's settled live P&L is
  // past it, the server stops trading for the rest of the day (it keeps
  // recording the tape below only if it never gets here).
  if (settings.enabled) {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: dayRows } = await db
      .from("trade_log")
      .select("pnl")
      .gte("ts", dayStart.toISOString())
      .not("pnl", "is", null);
    const dayPnl = ((dayRows ?? []) as { pnl: number }[]).reduce((a, r) => a + r.pnl, 0);
    if (dayPnl <= -cap) {
      const msg = `day stopped — loss cap $${cap.toFixed(0)} reached (${dayPnl.toFixed(2)} today)`;
      await heartbeat(msg);
      return { ok: true, sampled: 0, signals: 0, placed: 0, msg };
    }
  }

  // Real money only: don't attempt anything when the wallet can't cover one bet.
  let fundsOk = true;
  if (settings.enabled) {
    const keyId = process.env["KALSHI_API_KEY_ID"];
    const pem = process.env["KALSHI_PRIVATE_KEY"];
    if (!keyId || !pem) {
      await heartbeat("live requested but server keys are missing");
      return { ok: false, sampled: 0, signals: 0, placed: 0, msg: "no live keys" };
    }
    try {
      const balance = await fetchLiveBalance({ keyId, pem });
      if (balance < settings.bet_size) {
        fundsOk = false;
        await heartbeat(
          `waiting for funds — wallet $${balance.toFixed(2)} below $${settings.bet_size} bet size`,
        );
      }
    } catch {
      // Balance unreadable this tick: let the order path report its own error.
    }
  }

  let sampled = 0;
  let placedNow = 0;
  let rounds = 0;
  let lastSignals = 0;
  let lastMsg = "watching · outside trade window";
  let candleId = -1;
  let remaining = 0;
  const tradedPairs = new Set<string>();

  while (Date.now() < deadline) {
    rounds += 1;

    // ---- 1. Sample the feeds and record the tape --------------------------
    const c = candleInfo();
    // Spot first: the strike nearest spot is the only tradable one of the many
    // strikes each candle lists, so the market pull needs the price.
    const spots = await fetchSpots();
    for (const p of PAIRS) if (spots[p.id]) latestSpots[p.id] = spots[p.id]!;
    const mkts = await fetchAllMarkets(latestSpots);
    const snapshotRows: SnapshotInsert[] = [];
    const roundAt = Date.now();
    for (const p of PAIRS) {
      const m = mkts[p.id];
      if (m) {
        markets[p.id] = m;
        marketAt[p.id] = roundAt;
      } else if (roundAt - (marketAt[p.id] ?? 0) > MAX_QUOTE_AGE_MS) {
        // Never score a book we can no longer confirm: a stale quote reads as a
        // huge (fake) edge and then fails at order time as "quote moved".
        delete markets[p.id];
        delete marketAt[p.id];
      }
      const price = spots[p.id];
      if (!price) continue;
      latestSpots[p.id] = price;
      const known = markets[p.id];
      snapshotRows.push({
        candle_id: c.id,
        seconds_in: c.elapsed,
        pair: p.id,
        ticker: known?.ticker ?? null,
        spot: price,
        strike: known?.strike ?? null,
        yes_bid: known?.yesBid ?? null,
        yes_ask: known?.yesAsk ?? null,
        yes_mid: known?.yesMid ?? null,
        spread: known?.spread ?? null,
        vol: known?.vol ?? null,
      });
    }

    if (!snapshotRows.length) {
      lastMsg = "feeds unavailable — no spot prices this round";
      await sleep(SAMPLE_GAP_MS);
      continue;
    }
    await db.from("market_snapshots").insert(snapshotRows);
    sampled += snapshotRows.length;

    // ---- 2. Candle bookkeeping (once per candle) --------------------------
    if (c.id !== candleId) {
      candleId = c.id;
      const { data: existing } = await db
        .from("trade_log")
        .select("pair")
        .eq("candle_id", c.id)
        .eq("status", "placed");
      tradedPairs.clear();
      for (const r of (existing ?? []) as { pair: string }[]) tradedPairs.add(r.pair);
      remaining = Math.max(0, settings.max_trades - tradedPairs.size);
      // Tape retention: one sweep per candle, keep a week of snapshots.
      if (c.elapsed < 60) {
        await db
          .from("market_snapshots")
          .delete()
          .lt("ts", new Date(Date.now() - TAPE_RETENTION_MS).toISOString());
      }
    }

    // ---- 3. Rebuild the engine's inputs from this candle's tape -----------
    const { data: tape } = await db
      .from("market_snapshots")
      .select("pair, spot, yes_mid, ts")
      .eq("candle_id", c.id)
      .order("ts", { ascending: true })
      .limit(4000);

    const spot: Partial<Record<PairId, SpotState>> = {};
    const history: Partial<Record<PairId, number[]>> = {};
    for (const p of PAIRS) {
      const rows = (
        (tape ?? []) as { pair: string; spot: number; yes_mid: number | null; ts: string }[]
      ).filter((r) => r.pair === p.id);
      const ticks: SpotTick[] = rows.map((r) => ({ price: r.spot, ts: new Date(r.ts).getTime() }));
      const last = ticks[ticks.length - 1];
      const prev = ticks[ticks.length - 2];
      spot[p.id] = {
        price: last?.price ?? latestSpots[p.id] ?? 0,
        prev: prev?.price ?? last?.price ?? 0,
        change24h: 0,
        ts: last?.ts ?? Date.now(),
        ticks,
      };
      history[p.id] = rows.map((r) => r.yes_mid).filter((v): v is number => v != null);
    }

    // ---- 4. Same gates, same math as the dashboard ------------------------
    const now = Date.now();
    const scored = computeSignals(spot, markets, history, now);
    const signals = rankSignals(dropVetoed(scored));
    const trace = getSignalTrace();
    lastSignals = signals.length;

    const slot = Math.floor(candleInfo(now).elapsed / 5) * 5;
    const fired = new Map(signals.map((s) => [s.pair, s]));
    const logRows: SignalInsert[] = trace.map((t) => {
      const s = fired.get(t.pair);
      const m = markets[t.pair];
      return {
        candle_id: c.id,
        seconds_in: slot,
        pair: t.pair as string,
        verdict: t.verdict,
        reason: t.reason,
        source: "server",
        dir: s?.dir ?? t.dir ?? null,
        conf: s?.conf ?? null,
        calibrated: s?.calibrated ?? null,
        entry_price: s?.entry ?? null,
        ev: s?.ev ?? null,
        yes_mid: m?.yesMid ?? null,
        spread: m?.spread ?? null,
        skew: s?.skew ?? null,
        spot_mom: s?.spotMom ?? null,
        k_mom: s?.kMom ?? null,
        sigma_dist: s?.sigmaDist ?? null,
        spot: spot[t.pair]?.price ?? null,
        strike: m?.strike ?? null,
      };
    });
    // Pairs the engine fired but selection dropped (cooldown) — visible, not silent.
    for (const s of scored) {
      if (fired.has(s.pair)) continue;
      logRows.push({
        candle_id: c.id,
        seconds_in: slot,
        pair: s.pair as string,
        verdict: "skipped",
        reason: "pair paused — cooldown after losses",
        source: "server",
        dir: s.dir,
        conf: s.conf,
        entry_price: s.entry,
        ev: s.ev,
      });
    }


    // ---- 5. Trade, only when enabled and inside the window ----------------
    const inWindow = c.elapsed >= GATE_SECS && c.elapsed < CLOSE_SECS;
    if (!settings.enabled) {
      lastMsg = `tape ok · ${signals.length} live signal(s) · server bot OFF`;
    } else if (!inWindow) {
      lastMsg = "watching · outside trade window";
    } else if (!fundsOk) {
      // heartbeat already explains the wallet shortfall
    } else if (!signals.length) {
      lastMsg = "in window · no signal passed the gates";
    } else if (remaining <= 0) {
      lastMsg = `max ${settings.max_trades} trades already placed this candle`;
    } else {
      for (const sig of signals) {
        if (remaining <= 0) {
          logRows.push({
            candle_id: c.id, seconds_in: slot, pair: sig.pair, verdict: "skipped",
            reason: `candle cap reached — ${settings.max_trades} placed`, source: "server",
            dir: sig.dir, conf: sig.conf, entry_price: sig.entry, ev: sig.ev,
          });
          continue;
        }
        if (tradedPairs.has(sig.pair)) {
          logRows.push({
            candle_id: c.id, seconds_in: slot, pair: sig.pair, verdict: "skipped",
            reason: "duplicate blocked — pair already traded this candle", source: "server",
            dir: sig.dir, conf: sig.conf, entry_price: sig.entry, ev: sig.ev,
          });
          continue;
        }
        const skip = (reason: string) => {
          logRows.push({
            candle_id: c.id,
            seconds_in: slot,
            pair: sig.pair as string,
            verdict: "skipped",
            reason,
            source: "server",
            dir: sig.dir,
            conf: sig.conf,
            entry_price: sig.entry,
            ev: sig.ev,
          });
        };
        // Always re-price off a freshly pulled book, and make sure it is the SAME
        // market the signal was scored on. Scoring one candle and ordering in the
        // next is what produced the "quote moved 17¢" skips.
        const scoredTicker = markets[sig.pair]?.ticker ?? null;
        const fresh = await fetchOneMarket(sig.pair, latestSpots[sig.pair] ?? null);
        if (fresh) {
          markets[sig.pair] = fresh;
          marketAt[sig.pair] = Date.now();
        }
        const m = fresh;
        if (!m?.ticker) {
          skip("no open market ticker this round");
          continue;
        }
        if (scoredTicker && scoredTicker !== m.ticker) {
          skip("candle rolled over — re-scoring on the new market instead of chasing");
          continue;
        }


        const freshEntry = sig.dir === "YES" ? m.yesAsk : 1 - m.yesBid;
        if (!Number.isFinite(freshEntry) || freshEntry <= 0 || freshEntry >= 1) {
          skip("no live quote at the touch");
          continue;
        }
        const drift = Math.round((freshEntry - sig.entry) * 100);
        if (drift > MAX_SLIPPAGE_CENTS) {
          skip(`price ran away — ${drift}¢ worse than the signal`);
          continue;
        }
        const priceCents = Math.max(1, Math.min(99, Math.round(freshEntry * 100)));
        // Skip pairs with nothing resting at the touch; shrink to available size.
        const depth = restingDepth(m, sig.dir);
        if (depth < MIN_RESTING_DEPTH) {
          skip(`book too thin — ${depth} resting at ${priceCents}¢`);
          continue;
        }
        const count = Math.max(
          1,
          Math.min(depth, Math.floor(settings.bet_size / Math.max(0.01, freshEntry))),
        );
        let status = "placed";
        let msg = "";
        let contracts = count;
        let entry = freshEntry;
        let orderId: string | null = null;

        const keyId = process.env["KALSHI_API_KEY_ID"];
        const pem = process.env["KALSHI_PRIVATE_KEY"];
        if (!keyId || !pem) {
          status = "failed";
          msg = "Live keys not configured on the server.";
        } else {
          // A tick may place more than one order. Re-check funds immediately
          // before every submission so an earlier fill cannot starve a later one.
          let freshBalance: number | null = null;
          try {
            freshBalance = await fetchLiveBalance({ keyId, pem });
          } catch {
            status = "failed";
            msg = "Balance recheck failed — no live order was sent.";
          }
          const required = count * freshEntry;
          if (freshBalance !== null && freshBalance + 0.0001 < required) {
            status = "failed";
            msg = `Insufficient Kalshi balance — $${freshBalance.toFixed(2)} available, $${required.toFixed(2)} required.`;
          }
          if (status !== "failed") {
            const res = await placeLiveOrder(
              { keyId, pem },
              {
                ticker: m.ticker,
                side: sig.dir === "YES" ? "yes" : "no",
                priceCents,
                count,
                maxPriceCents: Math.min(99, priceCents + MAX_SLIPPAGE_CENTS),
              },
            );
            if (res.ok) {
              contracts = res.filled;
              entry = res.priceCents / 100;
              orderId = res.orderId;
              msg = `SERVER LIVE ${sig.dir} ×${res.filled} @ ${res.priceCents}¢ · ${res.status}`;
            } else {
              status = "failed";
              msg = res.error ?? "Order rejected";
            }
          }
        }

        await db.from("trade_log").insert({
          candle_id: c.id,
          pair: sig.pair,
          dir: sig.dir,
          mode: "live",
          conf: sig.conf,
          calibrated: sig.calibrated,
          contracts,
          entry_price: entry,
          stake: contracts * entry,
          status,
          msg,
          order_id: orderId,
          source: "server",
        });

        if (status === "placed") {
          placedNow += 1;
          tradedPairs.add(sig.pair);
          remaining -= 1;
        }
      }
      lastMsg =
        placedNow > 0
          ? `placed ${placedNow} live trade(s) this tick`
          : `in window · ${signals.length} signal(s) · no fill`;
    }

    if (logRows.length) {
      await db
        .from("signal_log")
        .upsert(logRows, {
          onConflict: "candle_id,pair,verdict,seconds_in,source",
          ignoreDuplicates: true,
        });
    }

    if (Date.now() + SAMPLE_GAP_MS >= deadline) break;
    await sleep(SAMPLE_GAP_MS);
  }

  if (sampled === 0) {
    await heartbeat("feeds unavailable — no spot prices this tick");
    return { ok: false, error: "no spot prices", ms: Date.now() - startedAt };
  }
  if (fundsOk) await heartbeat(`${lastMsg} · ${rounds} looks`);
  return {
    ok: true,
    sampled,
    rounds,
    signals: lastSignals,
    placed: placedNow,
    msg: lastMsg,
  };
}

/**
 * Public scheduled entrypoint. The database update is atomic, so concurrent
 * HTTP/cron invocations cannot both trade the same candle.
 */
export async function runServerBotTick() {
  const db = await admin();
  const leaseId = crypto.randomUUID();
  const { data: acquired, error } = await db.rpc("acquire_bot_run_lease", {
    p_lease_id: leaseId,
    p_lease_seconds: RUN_LEASE_SECONDS,
  });
  if (error) throw error;
  if (!acquired) {
    return { ok: true, sampled: 0, rounds: 0, signals: 0, placed: 0, msg: "runner busy — overlapping tick skipped" };
  }

  try {
    return await runOwnedServerBotTick(db);
  } finally {
    await db
      .from("bot_settings")
      .update({ run_lease_id: null, run_lease_until: null })
      .eq("id", true)
      .eq("run_lease_id", leaseId);
  }
}

