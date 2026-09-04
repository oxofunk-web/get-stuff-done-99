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
 * Order placement is gated by settings and always runs in paper mode until
 * live has been separately confirmed after a 24h warmup. All durable state
 * lives in Supabase — workers are stateless, so nothing important is kept in
 * module memory.
 */
import { emptyTable, type PairCalibration } from "./calibration";
import { candleInfo } from "./candle";
import {
  CLOSE_SECS,
  DAILY_LOSS_CAP_DEFAULT,
  GATE_SECS,
  MAX_SLIPPAGE_CENTS,
  MIN_RESTING_DEPTH,
  PAIRS,
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
const TICK_BUDGET_MS = 52_000;
/** Server bot must paper-trade this long before live can be armed. */
export const WARMUP_MS = 24 * 3600 * 1000;
const TAPE_RETENTION_MS = 7 * 24 * 3600 * 1000;


export interface ServerBotRow {
  id: boolean;
  enabled: boolean;
  mode: "paper" | "live";
  bet_size: number;
  ev_margin: number;
  max_trades: number;
  first_enabled_at: string | null;
  live_confirmed_at: string | null;
  last_tick_at: string | null;
  last_tick_msg: string | null;
  daily_loss_cap: number;
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
    mode: "paper",
    bet_size: 5,
    ev_margin: 0.08,
    max_trades: 2,
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

/** Milliseconds of mandatory paper warmup remaining before live can be armed. */
export function warmupMsLeft(row: ServerBotRow) {
  if (!row.first_enabled_at) return WARMUP_MS;
  return Math.max(0, WARMUP_MS - (Date.now() - new Date(row.first_enabled_at).getTime()));
}

/** The mode the server actually trades in — never live before its gates pass. */
export function effectiveMode(row: ServerBotRow): "paper" | "live" {
  if (row.mode !== "live") return "paper";
  if (!row.live_confirmed_at) return "paper";
  if (warmupMsLeft(row) > 0) return "paper";
  return "live";
}

export interface ServerBotState {
  ok: boolean;
  enabled: boolean;
  requestedMode: "paper" | "live";
  effectiveMode: "paper" | "live";
  betSize: number;
  evMargin: number;
  maxTrades: number;
  dailyLossCap: number;
  warmupHoursLeft: number;
  liveConfirmed: boolean;
  lastTickAt: string | null;
  lastTickMsg: string | null;
  recentTrades: {
    ts: string;
    candle_id: number;
    pair: string;
    dir: string;
    mode: string;
    status: string;
    msg: string | null;
    outcome: string | null;
    pnl: number | null;
  }[];
  error?: string;
}

export async function getServerBotState(db: Db): Promise<ServerBotState> {
  const s = await loadSettings(db);
  const { data: recent } = await db
    .from("trade_log")
    .select("ts, candle_id, pair, dir, mode, status, msg, outcome, pnl")
    .eq("source", "server")
    .order("ts", { ascending: false })
    .limit(8);
  return {
    ok: true,
    enabled: s.enabled,
    requestedMode: s.mode,
    effectiveMode: effectiveMode(s),
    betSize: s.bet_size,
    evMargin: s.ev_margin,
    maxTrades: s.max_trades,
    dailyLossCap: s.daily_loss_cap ?? DAILY_LOSS_CAP_DEFAULT,
    warmupHoursLeft: Math.round((warmupMsLeft(s) / 3600000) * 10) / 10,
    liveConfirmed: Boolean(s.live_confirmed_at),
    lastTickAt: s.last_tick_at,
    lastTickMsg: s.last_tick_msg,
    recentTrades: (recent ?? []) as ServerBotState["recentTrades"],
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

async function fetchAllMarkets(): Promise<Partial<Record<PairId, KalshiMarket>>> {
  const results = await Promise.all(
    PAIRS.map(async (p) => {
      const raw = await fetchOpenMarket(p.series);
      if (!raw) return null;
      return { pair: p.id, ...normalizeMarket(raw) } as KalshiMarket;
    }),
  );
  const out: Partial<Record<PairId, KalshiMarket>> = {};
  for (const m of results) if (m) out[m.pair] = m;
  return out;
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
export async function runServerBotTick() {
  const startedAt = Date.now();
  const db = await admin();
  const settings = await loadSettings(db);
  const deadline = startedAt + TICK_BUDGET_MS;

  const markets: Partial<Record<PairId, KalshiMarket>> = {};
  const latestSpots: Partial<Record<PairId, number>> = {};

  const heartbeat = async (msg: string) => {
    await db
      .from("bot_settings")
      .update({ last_tick_at: new Date().toISOString(), last_tick_msg: msg })
      .eq("id", true);
  };

  // ---- Engine inputs that only change per tick ----------------------------
  resetTuning();
  setTuning({ evMargin: settings.ev_margin });
  const cal = await loadCalibration(db);
  setCalibration(cal.table, cal.pairTable);
  setPairEdge(cal.pairEdge);

  const effMode = effectiveMode(settings);
  const cap = settings.daily_loss_cap ?? DAILY_LOSS_CAP_DEFAULT;

  // Same daily loss cap the dashboard shows: once today's settled live P&L is
  // past it, the server stops trading for the rest of the day (it keeps
  // recording the tape below only if it never gets here).
  if (settings.enabled && effMode === "live") {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: dayRows } = await db
      .from("trade_log")
      .select("pnl")
      .eq("mode", "live")
      .gte("ts", dayStart.toISOString())
      .not("pnl", "is", null);
    const dayPnl = ((dayRows ?? []) as { pnl: number }[]).reduce((a, r) => a + r.pnl, 0);
    if (dayPnl <= -cap) {
      const msg = `day stopped — loss cap $${cap.toFixed(0)} reached (${dayPnl.toFixed(2)} today)`;
      await heartbeat(msg);
      return { ok: true, sampled: 0, signals: 0, placed: 0, msg };
    }
  }

  // Live mode: don't attempt anything when the wallet can't cover one bet.
  let fundsOk = true;
  if (settings.enabled && effMode === "live") {
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
    const [spots, mkts] = await Promise.all([fetchSpots(), fetchAllMarkets()]);
    const snapshotRows: SnapshotInsert[] = [];
    for (const p of PAIRS) {
      const m = mkts[p.id];
      if (m) markets[p.id] = m;
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
        if (remaining <= 0) break;
        if (tradedPairs.has(sig.pair)) continue;
        const m = markets[sig.pair];
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
        if (!m?.ticker) {
          skip("no open market ticker this round");
          continue;
        }

        const priceCents = Math.max(1, Math.min(99, Math.round(sig.entry * 100)));
        // Skip pairs with nothing resting at the touch; shrink to available size.
        const depth = restingDepth(m, sig.dir);
        if (depth < MIN_RESTING_DEPTH) {
          skip(`book too thin — ${depth} resting at ${priceCents}¢`);
          continue;
        }
        const count = Math.max(
          1,
          Math.min(depth, Math.floor(settings.bet_size / Math.max(0.01, sig.entry))),
        );
        let status = "placed";
        let msg = "";
        let contracts = count;
        let entry = sig.entry;
        let orderId: string | null = null;

        if (effMode === "paper") {
          msg = `SERVER PAPER ${sig.dir} ×${count} @ ${priceCents}¢ · conf ${sig.conf.toFixed(0)}%`;
        } else {
          const keyId = process.env["KALSHI_API_KEY_ID"];
          const pem = process.env["KALSHI_PRIVATE_KEY"];
          if (!keyId || !pem) {
            status = "failed";
            msg = "Live keys not configured on the server.";
          } else {
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
          mode: effMode,
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
          ? `placed ${placedNow} ${effMode} trade(s) this tick`
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
  return { ok: true, sampled, rounds, signals: lastSignals, placed: placedNow, msg: lastMsg };
}

