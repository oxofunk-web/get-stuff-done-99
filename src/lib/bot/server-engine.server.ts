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
import { emptyTable } from "./calibration";
import { candleInfo } from "./candle";
import { CLOSE_SECS, GATE_SECS, PAIRS, type PairId } from "./constants";
import { computeSignals, getSignalTrace, setCalibration } from "./signals";
import { resetTuning, setTuning } from "./tuning";
import { fetchOpenMarket, normalizeMarket, placeLiveOrder } from "../kalshi.server";
import type { KalshiMarket, SpotState, SpotTick } from "./types";

/**
 * Short sampling burst per tick. One sample per minute is too thin for the
 * momentum math (minTicks = 24), so each tick takes a quick burst; by the time
 * the trade window opens the candle already holds dozens of fresh ticks.
 */
const SAMPLES = 4;
const SAMPLE_GAP_MS = 3500;
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
  warmupHoursLeft: number;
  liveConfirmed: boolean;
  lastTickAt: string | null;
  lastTickMsg: string | null;
  recentTrades: {
    ts: string;
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
    .select("ts, pair, dir, mode, status, msg, outcome, pnl")
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

/** Calibration table from settled signal outcomes — same bands as the client. */
async function loadCalibration(db: Db) {
  const table = emptyTable();
  const { data } = await db
    .from("signal_log")
    .select("conf, outcome")
    .not("outcome", "is", null)
    .not("conf", "is", null)
    .limit(20000);
  for (const r of (data ?? []) as { conf: number; outcome: string }[]) {
    const band = table.find((b) => r.conf >= b.lo && r.conf < b.hi);
    if (band) {
      band.n += 1;
      if (r.outcome === "win") band.wins += 1;
    }
  }
  return table;
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

export async function runServerBotTick() {
  const startedAt = Date.now();
  const db = await admin();
  const settings = await loadSettings(db);

  // ---- 1. Burst-sample the feeds and record the tape ----------------------
  const markets: Partial<Record<PairId, KalshiMarket>> = {};
  const latestSpots: Partial<Record<PairId, number>> = {};
  const snapshotRows: SnapshotInsert[] = [];

  for (let i = 0; i < SAMPLES; i += 1) {
    const sampleAt = Date.now();
    const c = candleInfo(sampleAt);
    const [spots, mkts] = await Promise.all([fetchSpots(), fetchAllMarkets()]);
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
    if (i < SAMPLES - 1) await sleep(SAMPLE_GAP_MS);
  }

  const heartbeat = async (msg: string) => {
    await db
      .from("bot_settings")
      .update({ last_tick_at: new Date().toISOString(), last_tick_msg: msg })
      .eq("id", true);
  };

  if (!snapshotRows.length) {
    await heartbeat("feeds unavailable — no spot prices this tick");
    return { ok: false, error: "no spot prices", ms: Date.now() - startedAt };
  }
  await db.from("market_snapshots").insert(snapshotRows);

  // Tape retention: one sweep per candle, keep a week of snapshots.
  const cNow = candleInfo();
  if (cNow.elapsed < 30) {
    await db
      .from("market_snapshots")
      .delete()
      .lt("ts", new Date(Date.now() - TAPE_RETENTION_MS).toISOString());
  }

  // ---- 2. Rebuild the engine's inputs from this candle's tape -------------
  const { data: tape } = await db
    .from("market_snapshots")
    .select("pair, spot, yes_mid, ts")
    .eq("candle_id", cNow.id)
    .order("ts", { ascending: true })
    .limit(4000);

  const spot: Partial<Record<PairId, SpotState>> = {};
  const history: Partial<Record<PairId, number[]>> = {};
  for (const p of PAIRS) {
    const rows = ((tape ?? []) as { pair: string; spot: number; yes_mid: number | null; ts: string }[]).filter(
      (r) => r.pair === p.id,
    );
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

  // ---- 3. Same gates, same math as the dashboard --------------------------
  resetTuning();
  setTuning({ evMargin: settings.ev_margin });
  setCalibration(await loadCalibration(db));

  const now = Date.now();
  const signals = computeSignals(spot, markets, history, now);
  const trace = getSignalTrace();

  // Record every decision so settlement + calibration keep learning even with
  // no browser open.
  const slot = Math.floor(candleInfo(now).elapsed / 5) * 5;
  const fired = new Map(signals.map((s) => [s.pair, s]));
  const sigRows = trace.map((t) => {
    const s = fired.get(t.pair);
    const m = markets[t.pair];
    return {
      candle_id: cNow.id,
      seconds_in: slot,
      pair: t.pair as string,
      verdict: t.verdict,
      reason: t.reason,
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
  if (sigRows.length) {
    await db
      .from("signal_log")
      .upsert(sigRows, { onConflict: "candle_id,pair,verdict,seconds_in", ignoreDuplicates: true });
  }

  // ---- 4. Trade, only when enabled and inside the window ------------------
  let placedNow = 0;
  if (!settings.enabled) {
    await heartbeat(`tape ok · ${signals.length} live signal(s) · server bot OFF`);
    return { ok: true, sampled: snapshotRows.length, signals: signals.length, placed: 0, msg: "bot off" };
  }

  const c3 = candleInfo();
  if (c3.elapsed < GATE_SECS || c3.elapsed >= CLOSE_SECS || !signals.length) {
    await heartbeat(`watching · ${signals.length} signal(s) · outside trade window`);
    return { ok: true, sampled: snapshotRows.length, signals: signals.length, placed: 0, msg: "outside window" };
  }

  const effMode = effectiveMode(settings);
  const { data: existing } = await db
    .from("trade_log")
    .select("pair")
    .eq("candle_id", c3.id)
    .eq("source", "server")
    .eq("status", "placed");
  const tradedPairs = new Set(((existing ?? []) as { pair: string }[]).map((r) => r.pair));
  let remaining = Math.max(0, settings.max_trades - tradedPairs.size);

  for (const sig of signals) {
    if (remaining <= 0) break;
    if (tradedPairs.has(sig.pair)) continue;
    const m = markets[sig.pair];
    if (!m?.ticker) continue;

    const priceCents = Math.max(1, Math.min(99, Math.round(sig.entry * 100)));
    const count = Math.max(1, Math.floor(settings.bet_size / Math.max(0.01, sig.entry)));
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
          { ticker: m.ticker, side: sig.dir === "YES" ? "yes" : "no", priceCents, count },
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
      candle_id: c3.id,
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

  const summary =
    placedNow > 0
      ? `placed ${placedNow} ${effMode} trade(s) this tick`
      : tradedPairs.size >= settings.max_trades
        ? `max ${settings.max_trades} trades already placed this candle`
        : `in window · ${signals.length} signal(s) · no fill`;
  await heartbeat(summary);
  return { ok: true, sampled: snapshotRows.length, signals: signals.length, placed: placedNow, msg: summary };
}
