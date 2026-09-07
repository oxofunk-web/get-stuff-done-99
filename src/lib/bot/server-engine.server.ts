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
 * memory. Filled positions are held until the candle settles.
 */
import { emptyTable, type PairCalibration } from "./calibration";
import { candleInfo } from "./candle";
import {
  BOOTSTRAP_MAX_DAILY_DEFAULT,
  BOOTSTRAP_MAX_ENTRY_DEFAULT,
  BOOTSTRAP_STAKE_DEFAULT,
  CLOSE_SECS,
  DAILY_LOSS_CAP_DEFAULT,
  GATE_SECS,
  MAX_CHASE_CENTS,
  MAX_ORDER_ATTEMPTS,
  MAX_SPREAD,
  MAX_YES_MID,
  MIN_RESTING_DEPTH,
  MIN_SIGMA_DIST,
  MIN_SKEW,
  MIN_YES_MID,
  PAIRS,
  STRATEGY_VERSION,
  THRESHOLD,
  type PairId,
} from "./constants";
import { computeSignals, getSignalTrace, setCalibration } from "./signals";
import { dropVetoed, rankSignals, setPairEdge } from "./ranking";
import type { PairEdgeRow } from "./telemetry.functions";
import { resetTuning, setTuning } from "./tuning";
import { restingDepth } from "./order-map";
import {
  advanceStableSignal,
  freshMarketSupportsSignal,
  ORDER_CUTOFF_BUFFER_SECS,
  isStable,
  REQUIRED_STABLE_SAMPLES,

  type StableSignalCandidate,
} from "./stability";
import { fetchLiveBalance, fetchMarket, fetchOpenMarket, normalizeMarket, placeLiveOrder } from "../kalshi.server";
import type { KalshiMarket, SpotState, SpotTick } from "./types";

/**
 * Sampling. The momentum math needs ~60 ticks inside a candle, so one sample
 * per minute is far too thin when the dashboard isn't also feeding the tape.
 * Each tick therefore samples continuously for most of its minute, re-scoring
 * the engine after every sample — that gives the server the same
 * many-chances-per-candle view the dashboard has instead of a single look.
 */
const SAMPLE_GAP_MS = 2500;
/**
 * Time budget per tick. The cron wakes the runner every minute, so a 22s budget
 * left the engine blind for ~38s of every minute — signals that appeared in
 * those holes were never seen. Sample for almost the whole minute instead.
 */
const TICK_BUDGET_MS = 50_000;
/** Lease covers the work budget but expires before the next cron wake-up. */
const RUN_LEASE_SECONDS = 58;
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
  gate_secs?: number | null;
  gate_preset?: string | null;
  /** Learning mode: allow tiny real stakes on cheap legs before proof exists. */
  bootstrap_enabled?: boolean | null;
  bootstrap_stake?: number | null;
  bootstrap_max_daily?: number | null;
  bootstrap_max_entry?: number | null;
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
  /** Seconds into the 15-minute candle before the bot may look for a trade. */
  gateSecs: number;
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
    gateSecs: s.gate_secs ?? GATE_SECS,
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

/** Refresh the exact ticker that produced the signal; never switch strikes here. */
async function fetchOneMarket(pair: PairId, ticker: string): Promise<KalshiMarket | null> {
  try {
    const raw = await fetchMarket(ticker);
    if (!raw) return null;
    return { pair, ...normalizeMarket(raw) } as KalshiMarket;
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
    .from("trade_log")
    .select("candle_id, pair, dir, conf, outcome, entry_price, pnl, status, strategy_version")
    .eq("source", "server")
    .eq("status", "placed")
    .eq("strategy_version", STRATEGY_VERSION)
    .not("outcome", "is", null)
    // Unresolved contracts carry no information — they must never shape confidence.
    .neq("outcome", "void")
    .not("conf", "is", null)
    .limit(20000);
  const edge = new Map<string, PairEdgeRow>();
  type CalibrationRow = {
    candle_id: number;
    pair: string;
    dir: string | null;
    conf: number;
    outcome: string;
    verdict?: string;
    entry_price: number | null;
    pnl?: number | null;
  };
  const unique = new Map<string, CalibrationRow>();
  for (const r of (data ?? []) as CalibrationRow[]) {
    const key = `${r.candle_id}:${r.pair}`;
    if (!unique.has(key)) unique.set(key, r);
  }
  for (const r of unique.values()) {
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
    e.fired += 1;
    if (won) e.firedWins += 1;
    if (r.entry_price != null && r.entry_price > 0) {
      e.avgEntry = e.avgEntry + (r.entry_price - e.avgEntry) / e.fired;
    }
    e.pnl += r.pnl ?? 0;
    e.trades += 1;
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
  strike_type: "floor" | "cap" | null;
  quote_observed_at: string | null;
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
  strike_type?: "floor" | "cap" | null;
  strategy_version?: string;
  raw_score?: number | null;
  minute_in?: number | null;
  depth?: number | null;
  mom_z?: number | null;
  cushion_score?: number | null;
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
  let settings = await loadSettings(db);
  const armedAtStart = settings.enabled;
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
      .select("pair, ticker, strike, strike_type, yes_bid, yes_ask, yes_mid, spread, vol, ts")
      .eq("candle_id", seedCandle)
      .gte("ts", since)
      .not("ticker", "is", null)
      .order("ts", { ascending: true })
      .limit(2000);
    for (const r of (warm ?? []) as {
      pair: string;
      ticker: string | null;
      strike: number | null;
      strike_type: "floor" | "cap" | null;
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
        strikeType: r.strike_type,
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
    gateSecs: settings.gate_secs ?? GATE_SECS,
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
      .select("pnl, stake, status, outcome")
      .eq("source", "server")
      .gte("ts", dayStart.toISOString())
    const riskRows = (dayRows ?? []) as { pnl: number | null; stake: number | null; status: string; outcome: string | null }[];
    const dayPnl = riskRows.reduce((a, r) => a + (r.outcome === "void" ? 0 : r.pnl ?? 0), 0);
    const openRisk = riskRows.reduce(
      (a, r) => a + (r.status === "placed" && r.outcome == null ? Math.max(0, r.stake ?? 0) : 0),
      0,
    );
    if (dayPnl - openRisk <= -cap) {
      const msg = `day stopped — $${openRisk.toFixed(2)} open risk + ${dayPnl.toFixed(2)} settled P&L reaches the $${cap.toFixed(0)} cap`;
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

  // How much tiny-stake learning money has already been risked today. Kept
  // separate from the normal loss cap so learning can never bleed into it.
  let bootstrapSpentToday = 0;
  {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: bootRows } = await db
      .from("trade_log")
      .select("stake")
      .eq("source", "server")
      .eq("status", "placed")
      .like("msg", "BOOTSTRAP%")
      .gte("ts", dayStart.toISOString());
    bootstrapSpentToday = ((bootRows ?? []) as { stake: number | null }[]).reduce(
      (a, r) => a + Math.max(0, r.stake ?? 0),
      0,
    );
  }

  let sampled = 0;
  let placedNow = 0;
  let rounds = 0;
  let lastSignals = 0;
  let lastMsg = "watching · outside trade window";
  let candleId = -1;
  let remaining = 0;
  const tradedPairs = new Set<string>();
  const attemptsByPair = new Map<string, number>();
  const lockedTickers = new Map<PairId, string>();
  const stableCandidates = new Map<PairId, StableSignalCandidate>();
  /**
   * One decision per pair per candle. Without this the runner re-scored the
   * same opportunity ~16 times per candle, so every accuracy number counted a
   * single opportunity as sixteen.
   */
  const decidedPairs = new Set<string>();

  while (Date.now() < deadline) {
    rounds += 1;

    // ---- 1. Sample the feeds and record the tape --------------------------
    const c = candleInfo();
    // Reset durable per-candle state before reading feeds. A feed outage on the
    // first round must not leave the previous candle's locks/caps in memory.
    if (c.id !== candleId) {
      candleId = c.id;
      const { data: existing } = await db
        .from("trade_log")
        .select("pair, status")
        .eq("candle_id", c.id)
        .eq("source", "server");
      tradedPairs.clear();
      attemptsByPair.clear();
      lockedTickers.clear();
      stableCandidates.clear();
      decidedPairs.clear();
      for (const r of (existing ?? []) as { pair: string; status: string }[]) {
        attemptsByPair.set(r.pair, (attemptsByPair.get(r.pair) ?? 0) + 1);
        if (r.status === "placed") tradedPairs.add(r.pair);
      }
      remaining = Math.max(0, settings.max_trades - tradedPairs.size);
      if (c.elapsed < 60) {
        await db
          .from("market_snapshots")
          .delete()
          .lt("ts", new Date(Date.now() - TAPE_RETENTION_MS).toISOString());
      }
    }
    // A dashboard OFF command takes effect during this run. Turning ON waits
    // for the next run so balance and loss-cap checks cannot be bypassed.
    settings = await loadSettings(db);
    const enabledNow = armedAtStart && settings.enabled;
    setTuning({
      evMargin: settings.ev_margin,
      threshold: settings.threshold ?? THRESHOLD,
      minYesMid: settings.min_yes_mid ?? MIN_YES_MID,
      maxYesMid: settings.max_yes_mid ?? MAX_YES_MID,
      minSkew: settings.min_skew ?? MIN_SKEW,
      maxSpread: settings.max_spread ?? MAX_SPREAD,
      minSigmaDist: settings.min_sigma_dist ?? MIN_SIGMA_DIST,
      gateSecs: settings.gate_secs ?? GATE_SECS,
    });
    // Spot first: the strike nearest spot is the only tradable one of the many
    // strikes each candle lists, so the market pull needs the price.
    const spots = await fetchSpots();
    for (const p of PAIRS) if (spots[p.id]) latestSpots[p.id] = spots[p.id]!;
    const mkts = await fetchAllMarkets(latestSpots);
    const snapshotRows: SnapshotInsert[] = [];
    const roundAt = Date.now();
    for (const p of PAIRS) {
      const candidate = mkts[p.id];
      const lockedTicker = lockedTickers.get(p.id);
      const m = candidate && (!lockedTicker || candidate.ticker === lockedTicker) ? candidate : undefined;
      if (m) {
        if (!lockedTicker) lockedTickers.set(p.id, m.ticker);
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
        strike_type: known?.strikeType ?? null,
        quote_observed_at: known ? new Date(marketAt[p.id] ?? roundAt).toISOString() : null,
        yes_bid: known?.yesBid ?? null,
        yes_ask: known?.yesAsk ?? null,
        yes_mid: known?.yesMid ?? null,
        spread: known?.spread ?? null,
        vol: known?.vol ?? null,
      });
    }

    // ---- 2. Persist this round's tape -------------------------------------
    if (!snapshotRows.length) {
      lastMsg = "feeds unavailable — no spot prices this round";
      await sleep(SAMPLE_GAP_MS);
      continue;
    }
    await db.from("market_snapshots").insert(snapshotRows);
    sampled += snapshotRows.length;

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
    const rankedSignals = rankSignals(dropVetoed(scored));
    const stablePairs = new Set<PairId>();
    for (const signal of rankedSignals) {
      const ticker = markets[signal.pair]?.ticker;
      if (!ticker) continue;
      const key = `${ticker}:${signal.dir}`;
      const next = advanceStableSignal(
        stableCandidates.get(signal.pair),
        key,
        now,
        SAMPLE_GAP_MS - 250,
        signal.sigmaDist,
      );
      stableCandidates.set(signal.pair, next);
      if (isStable(next)) stablePairs.add(signal.pair);
    }
    for (const pair of [...stableCandidates.keys()]) {
      if (!rankedSignals.some((signal) => signal.pair === pair)) stableCandidates.delete(pair);
    }
    const signals = rankedSignals.filter(
      (signal) => stablePairs.has(signal.pair) && !decidedPairs.has(signal.pair),
    );
    // Record this candle's single decision for each pair that just confirmed.
    for (const signal of signals) decidedPairs.add(signal.pair);
    const trace = getSignalTrace();
    lastSignals = signals.length;

    const slot = Math.floor(candleInfo(now).elapsed / 5) * 5;
    const fired = new Map(signals.map((s) => [s.pair, s]));
    const awaiting = new Map(
      rankedSignals
        .filter((s) => !stablePairs.has(s.pair) && !decidedPairs.has(s.pair))
        .map((s) => [s.pair, s]),
    );
    // Junk samples are not decisions: writing "outside the trade window" and
    // "not enough live data yet" for every pair every 5 seconds buried the real
    // signals (11k rows in 6h) and polluted what the dashboard calls a signal.
    const NOISE_REASONS = ["outside the trade window", "not enough live data yet"];
    const isNoise = (verdict: string, reason: string | null) =>
      verdict === "rejected" && !!reason && NOISE_REASONS.some((n) => reason.startsWith(n));
    const logRows: SignalInsert[] = trace
      .filter((t) => !decidedPairs.has(t.pair) || fired.has(t.pair))
      .filter((t) => !isNoise(t.verdict, t.reason) || fired.has(t.pair) || awaiting.has(t.pair))
      .map((t) => {

      const s = fired.get(t.pair);
      const pending = awaiting.get(t.pair);
      const m = markets[t.pair];
      // Rejected reads used to store empty confidence/price/edge, which made it
      // impossible to test whether the score separates winners from losers.
      // The trace now carries every measured feature, fired or not.
      const f = t.features;
      return {
        candle_id: c.id,
        seconds_in: slot,
        pair: t.pair as string,
        verdict: pending ? "rejected" : t.verdict,
        reason: pending
          ? `confirming — ${stableCandidates.get(t.pair)?.count ?? 1} of ${REQUIRED_STABLE_SAMPLES} matching live samples`
          : t.reason,

        source: "server",
        dir: s?.dir ?? pending?.dir ?? t.dir ?? null,
        conf: s?.conf ?? pending?.conf ?? f.conf ?? null,
        calibrated: s?.calibrated ?? pending?.calibrated ?? f.calibrated ?? null,
        entry_price: s?.entry ?? pending?.entry ?? f.entry ?? null,
        ev: s?.ev ?? pending?.ev ?? f.ev ?? null,
        yes_mid: m?.yesMid ?? f.yesMid ?? null,
        spread: m?.spread ?? f.spread ?? null,
        skew: s?.skew ?? f.skew ?? null,
        spot_mom: s?.spotMom ?? f.spotMom ?? null,
        k_mom: s?.kMom ?? f.kMom ?? null,
        sigma_dist: s?.sigmaDist ?? f.sigmaDist ?? null,
        spot: spot[t.pair]?.price ?? f.spot ?? null,
        strike: m?.strike ?? f.strike ?? null,
        strike_type: m?.strikeType ?? f.strikeType ?? null,
        strategy_version: STRATEGY_VERSION,
        raw_score: f.rawScore ?? null,
        minute_in: f.minuteIn ?? null,
        depth: f.depth ?? null,
        mom_z: f.momZ ?? null,
        cushion_score: f.cushionScore ?? null,
      };
    });

    // Pairs the engine fired but selection dropped (cooldown) — visible, not silent.
    for (const s of scored) {
      // Stable and still-confirming candidates are already represented above.
      // Only signals removed by ranking/cooldown belong in this branch.
      if (rankedSignals.some((ranked) => ranked.pair === s.pair)) continue;
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
    const gateSecs = settings.gate_secs ?? GATE_SECS;
    const inWindow = c.elapsed >= gateSecs && c.elapsed < CLOSE_SECS - ORDER_CUTOFF_BUFFER_SECS;
    if (!enabledNow) {
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
        const priorAttempts = attemptsByPair.get(sig.pair) ?? 0;
        if (priorAttempts >= MAX_ORDER_ATTEMPTS) {
          logRows.push({
            candle_id: c.id, seconds_in: slot, pair: sig.pair, verdict: "skipped",
            reason: `order retry limit reached — ${MAX_ORDER_ATTEMPTS} attempts this candle`, source: "server",
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
        if (!scoredTicker) {
          skip("no scored market ticker this round");
          continue;
        }
        const fresh = await fetchOneMarket(sig.pair, scoredTicker);
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
        const liveSpot = latestSpots[sig.pair] ?? 0;
        if (!freshMarketSupportsSignal(sig, m, liveSpot, settings.max_spread ?? MAX_SPREAD)) {
          skip("direction no longer confirmed by the fresh book and strike");
          continue;
        }


        const freshEntry = sig.dir === "YES" ? m.yesAsk : 1 - m.yesBid;
        if (!Number.isFinite(freshEntry) || freshEntry <= 0 || freshEntry >= 1) {
          skip("no live quote at the touch");
          continue;
        }
        // Keep chasing bounded by BOTH economics and an absolute safety cap.
        // EV = probability / price - 1, so the highest price that still clears
        // the saved EV margin is probability / (1 + margin).
        const valueCeiling = sig.calibrated / (1 + settings.ev_margin);
        const chaseCeiling = sig.entry + MAX_CHASE_CENTS / 100;
        // Learning mode: while real-fill probability is unproven the engine may
        // still take tiny positions, but only on cheap legs where the price
        // itself carries the edge and a loss is a couple of dollars. Without
        // this the bot can never collect the 50 real fills it waits for.
        const bootstrapOn = Boolean(settings.bootstrap_enabled) && !sig.calibrationReady;
        const bootstrapMaxEntry = settings.bootstrap_max_entry ?? BOOTSTRAP_MAX_ENTRY_DEFAULT;
        const bootstrapStake = settings.bootstrap_stake ?? BOOTSTRAP_STAKE_DEFAULT;
        const bootstrapDailyCap = settings.bootstrap_max_daily ?? BOOTSTRAP_MAX_DAILY_DEFAULT;
        const maxEntry = bootstrapOn
          ? Math.min(bootstrapMaxEntry, chaseCeiling)
          : Math.min(0.99, valueCeiling, chaseCeiling);
        const maxPriceCents = Math.max(1, Math.min(99, Math.floor(maxEntry * 100)));
        if (!sig.calibrationReady && !bootstrapOn) {
          skip("shadow only — real-fill probability is not proven yet");
          continue;
        }
        if (bootstrapOn && freshEntry > bootstrapMaxEntry + 1e-9) {
          skip(
            `learning mode only buys under ${Math.round(bootstrapMaxEntry * 100)}¢ — live ${Math.round(freshEntry * 100)}¢`,
          );
          continue;
        }
        if (bootstrapOn && bootstrapSpentToday + bootstrapStake > bootstrapDailyCap + 1e-9) {
          skip(
            `learning budget used up — $${bootstrapSpentToday.toFixed(2)} of $${bootstrapDailyCap.toFixed(2)} risked today`,
          );
          continue;
        }
        if (freshEntry * 100 > maxPriceCents + 0.0001) {
          skip(
            `price ran past value — ${Math.round(freshEntry * 100)}¢ live, ${maxPriceCents}¢ max`,
          );
          continue;
        }
        const priceCents = Math.max(1, Math.min(99, Math.round(freshEntry * 100)));
        // Skip pairs with nothing resting at the touch; shrink to available size.
        const depth = restingDepth(m, sig.dir);
        if (depth < MIN_RESTING_DEPTH) {
          skip(`book too thin — ${depth} resting at ${priceCents}¢`);
          continue;
        }
        const stakeTarget = bootstrapOn ? bootstrapStake : settings.bet_size;
        const count = Math.max(
          1,
          Math.min(depth, Math.floor(stakeTarget / Math.max(0.01, freshEntry))),
        );

        let status = "placed";
        let msg = "";
        let contracts = count;
        let entry = freshEntry;
        let orderId: string | null = null;
        let quoteAgeMs = Math.max(0, Date.now() - (marketAt[sig.pair] ?? Date.now()));
        let visibleDepth = depth;
        let submitMarket = m;

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
            const finalMarket = await fetchOneMarket(sig.pair, scoredTicker);
            if (!finalMarket || !freshMarketSupportsSignal(sig, finalMarket, liveSpot, settings.max_spread ?? MAX_SPREAD)) {
              status = "failed";
              msg = "Final quote no longer confirms the signal — no order was sent.";
            } else {
              submitMarket = finalMarket;
              quoteAgeMs = 0;
              visibleDepth = restingDepth(finalMarket, sig.dir);
              const submitEntry = sig.dir === "YES" ? finalMarket.yesAsk : finalMarket.noAsk;
              if (visibleDepth < MIN_RESTING_DEPTH || Math.round(submitEntry * 100) > maxPriceCents) {
                status = "failed";
                msg = "Final price or depth moved outside the safe limit — no order was sent.";
              }
            }
          }
          if (status !== "failed") {
            const res = await placeLiveOrder(
              { keyId, pem },
              {
                ticker: m.ticker,
                side: sig.dir === "YES" ? "yes" : "no",
                priceCents,
                count,
                maxPriceCents,
                quote: submitMarket,
              },
            );
            attemptsByPair.set(sig.pair, priorAttempts + 1);
            if (res.ok) {
              contracts = res.filled;
              entry = res.priceCents / 100;
              orderId = res.orderId;
              msg = `${bootstrapOn ? "BOOTSTRAP" : "SERVER LIVE"} ${sig.dir} ×${res.filled} @ ${res.priceCents}¢ · ${res.status}`;
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
          ticker: m.ticker,
          strike: m.strike,
          strike_type: m.strikeType,
          strategy_version: STRATEGY_VERSION,
          quote_age_ms: quoteAgeMs,
          requested_contracts: count,
          visible_depth: visibleDepth,
          source: "server",
        });

        if (status === "placed") {
          if (bootstrapOn) bootstrapSpentToday += contracts * entry;
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
        .upsert(logRows.map((row) => ({ ...row, strategy_version: STRATEGY_VERSION })), {
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

  // Grade closed candles on every tick, so real fill results feed confidence
  // without waiting on an external schedule.
  let settleNote = "";
  try {
    const { settlePending } = await import("./settle.server");
    const r = await settlePending(6);
    if (r.trades) settleNote = ` · graded ${r.trades} fill(s)`;
    if (r.voided) settleNote += ` · ${r.voided} void`;
  } catch {
    // Settlement is best-effort; a failure here must not stop sampling.
  }

  if (fundsOk) await heartbeat(`${lastMsg} · ${rounds} looks${settleNote}`);
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

