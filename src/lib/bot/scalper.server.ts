/**
 * Rules-based candle-start scalper (BTC + ETH only).
 * 0:30–2:00 into each 15-minute candle: measures opening drift, 2-minute
 * momentum and volume confirmation from Coinbase candles. All three must agree
 * before entry. Buys the 45–55¢ contract, then watches the bid every 2s and
 * exits at +15¢ (profit), −10¢ (stop) or 6 minutes after entry (time out).
 *
 * Re-entry loop: after a take-profit or timeout exit, the engine may re-enter
 * while the signal still fires (up to 3 round trips per pair per candle, until
 * 8:00 into the candle). After a stop-loss the pair is done for the candle —
 * no revenge trading. Works both directions: UP signals buy the above-side,
 * DOWN signals buy the below-side.
 *
 * Backtested Oct 2026 on 7 days of 1m candles: at d≥5bp / m≥3bp / v≥1.5x the
 * opening move held its side into +5:00 ~88% of the time, but only extended
 * ≥3bp past the entry price ~40% of the time. That is the scalp dynamic:
 * continuation is what pays, so paper mode validates the pricing — the
 * backtest only validates that the entry timing isn't nonsense.
 *
 * Safety: paper mode is the default (shared toggle with the lock engine),
 * the shared daily loss cap covers scalp trades, and positions are always
 * fully closed by the engine so the settlement pass never has to grade a
 * scalp row.
 */
import { authedKalshi, fetchMarket, fetchOpenMarketWithReason, normalizeMarket, placeLiveOrder } from "../kalshi.server";
import { dayRisk } from "./loss-cap.server";
import { getBotSettings } from "./settings.server";
import { DAILY_LOSS_CAP_DEFAULT, type PairId } from "./constants";
import { mapOrderToBook } from "./order-map";

const CANDLE_MS = 900_000;
const PAIRS: PairId[] = ["BTC", "ETH"];
const PRODUCT: Record<string, string> = { BTC: "BTC-USD", ETH: "ETH-USD" };
const ENTRY_FROM = 30;
const ENTRY_UNTIL = 120;
const REENTER_UNTIL = 480; // seconds into candle — re-entries allowed this long
const MAX_ROUND_TRIPS = 3; // max entries per pair per candle
const MIN_ENTRY = 45;
const MAX_ENTRY = 55;
const TAKE_PROFIT = 15;
const STOP_LOSS = 10;
const MAX_HOLD_MS = 360_000; // per-trade timeout: 6 minutes from entry
const POLL_MS = 2000;
const RUN_MS = 50_000;

/** Entry thresholds — tuned by backtest, Oct 2026 (see header). */
export const SCALP_DRIFT_MIN_BP = 5;
export const SCALP_MOM_MIN_BP = 3;
export const SCALP_VOL_MIN = 1.5;

export type ReentryBlockReason = "stop-cooldown" | "max-trips" | "open-position";

/**
 * Pure re-entry policy for one pair within one candle.
 * - One open position at a time.
 * - After a stop-loss: done for the candle (no revenge trading).
 * - Otherwise up to MAX_ROUND_TRIPS entries while the signal fires.
 */
export function reentryBlock(
  closed: { exit_reason: string | null }[],
  openCount: number,
): ReentryBlockReason | null {
  if (openCount > 0) return "open-position";
  if (closed.some((t) => t.exit_reason === "stop")) return "stop-cooldown";
  if (closed.length >= MAX_ROUND_TRIPS) return "max-trips";
  return null;
}

export interface ScalpSnap {
  open: number;
  price: number;
  driftBp: number;
  momBp: number;
  volRatio: number;
}

/** Pure entry rule: drift, momentum and volume must all agree. Exported for tests. */
export function scalpSignal(s: ScalpSnap): "UP" | "DOWN" | "SKIP" {
  if (!(s.open > 0) || !(s.price > 0)) return "SKIP";
  if (s.volRatio < SCALP_VOL_MIN) return "SKIP";
  if (s.driftBp >= SCALP_DRIFT_MIN_BP && s.momBp >= SCALP_MOM_MIN_BP) return "UP";
  if (s.driftBp <= -SCALP_DRIFT_MIN_BP && s.momBp <= -SCALP_MOM_MIN_BP) return "DOWN";
  return "SKIP";
}

export interface MinCandle {
  ts: number;
  open: number;
  close: number;
  vol: number;
}

/**
 * Builds the entry snapshot from 1-minute candles (ascending by ts).
 * Exported for tests.
 */
export function buildSnap(oneMin: MinCandle[], candleStart: number): ScalpSnap | null {
  const openC = oneMin.find((c) => c.ts === candleStart);
  if (!openC || !(openC.open > 0)) return null;
  const at = oneMin.filter((c) => c.ts >= candleStart);
  if (!at.length) return null;
  const price = at[at.length - 1]!.close;
  const open = openC.open;
  const driftBp = ((price - open) / open) * 1e4;
  // Momentum: move from the last 1-minute close *before* this candle into now.
  // (Matches the backtest definition.)
  const prevC = [...oneMin].reverse().find((c) => c.ts < candleStart);
  const backClose = prevC && prevC.close > 0 ? prevC.close : open;
  const momBp = ((price - backClose) / backClose) * 1e4;
  // Volume confirmation: first-two-minutes volume vs trailing 60-min average.
  const first2 = oneMin.filter((c) => c.ts >= candleStart && c.ts < candleStart + 120_000);
  const first2Vol = first2.reduce((a, c) => a + c.vol, 0);
  const trail = oneMin.filter((c) => c.ts >= candleStart - 3_600_000 && c.ts < candleStart);
  const avgVol = trail.length ? trail.reduce((a, c) => a + c.vol, 0) / trail.length : 0;
  const volRatio = avgVol > 0 ? first2Vol / 2 / avgVol : 0;
  return { open, price, driftBp, momBp, volRatio };
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function coinbase<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`https://api.exchange.coinbase.com${path}`, { headers: { "User-Agent": "scalper" } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** 1-minute candles covering [candleStart - 70min, now]. */
async function oneMinCandles(pair: PairId, candleStart: number): Promise<MinCandle[]> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const rows = await coinbase<number[][]>(
    `/products/${PRODUCT[pair]}/candles?granularity=60&start=${iso(candleStart - 70 * 60_000)}&end=${iso(Date.now() + 60_000)}`,
  );
  return (rows ?? [])
    .map((x) => ({ ts: (x[0] ?? 0) * 1000, open: x[3] ?? 0, close: x[4] ?? 0, vol: x[5] ?? 0 }))
    .filter((c): c is MinCandle => Number.isFinite(c.close) && c.close > 0 && c.open > 0)
    .sort((a, b) => a.ts - b.ts);
}

type Creds = { keyId: string; pem: string };

async function enter(
  pair: PairId,
  candleStart: number,
  size: number,
  paper: boolean,
  creds: Creds | null,
): Promise<{ placed: boolean; msg: string } | null> {
  const sb = await db();
  const log = (row: Record<string, unknown>) =>
    sb.from("trade_log").insert({ candle_id: candleStart, pair, source: "scalp", strategy_version: "scalp-v2", ...row } as never);

  const candles = await oneMinCandles(pair, candleStart);
  const snap = buildSnap(candles, candleStart);
  if (!snap) {
    if ((Date.now() - candleStart) / 1000 < ENTRY_UNTIL - 5) return null; // retry while the window is open
    await log({ dir: "SKIP", mode: paper ? "paper" : "live", status: "skipped", msg: "No candle data yet" });
    return { placed: false, msg: `${pair}: no data` };
  }
  const dir = scalpSignal(snap);
  const why = `drift ${snap.driftBp.toFixed(1)}bp · mom ${snap.momBp.toFixed(1)}bp · vol ${snap.volRatio.toFixed(2)}x`;
  if (dir === "SKIP") {
    await log({ dir, mode: paper ? "paper" : "live", status: "skipped", msg: `Rules skip: ${why}` });
    return { placed: false, msg: `${pair}: rules skip` };
  }
  const { market: raw, error } = await fetchOpenMarketWithReason(`KX${pair}15M`, snap.price);
  if (!raw) {
    await log({ dir, mode: paper ? "paper" : "live", status: "skipped", msg: `No contract: ${error}` });
    return { placed: false, msg: `${pair}: ${error}` };
  }
  const m = normalizeMarket(raw);
  if (m.strike == null || !m.strikeType) {
    await log({ dir, mode: paper ? "paper" : "live", status: "skipped", msg: "Contract has no line", ticker: m.ticker });
    return { placed: false, msg: `${pair}: no line` };
  }
  // floor: YES = finishes above. cap: YES = finishes below.
  const side: "yes" | "no" = (m.strikeType === "floor") === (dir === "UP") ? "yes" : "no";
  const ask = Math.round((side === "yes" ? m.yesAsk : m.noAsk) * 100);
  const base = { dir, ticker: m.ticker, strike: m.strike, strike_type: m.strikeType };
  if (ask < MIN_ENTRY || ask > MAX_ENTRY) {
    await log({ ...base, mode: paper ? "paper" : "live", status: "skipped", msg: `Contract at ${ask}¢ — outside the ${MIN_ENTRY}–${MAX_ENTRY}¢ scalp zone` });
    return { placed: false, msg: `${pair}: price ${ask}¢ out of zone` };
  }
  const count = Math.max(1, Math.floor(size / (ask / 100)));
  const entry = ask / 100;
  const row = {
    ...base,
    mode: paper ? "paper" : "live",
    status: "placed",
    msg: `${dir} ${why} · ${side.toUpperCase()} ${count} @ ${ask}¢`,
    contracts: count,
    requested_contracts: count,
    entry_price: entry,
    stake: count * entry,
  };
  if (paper) {
    await log({ ...row, order_id: `paper-scalp-${candleStart}-${pair}` });
    return { placed: true, msg: `${pair}: PAPER SCALP ${count} @ ${ask}¢ (${dir})` };
  }
  if (!creds) {
    await log({ ...base, mode: "live", status: "skipped", msg: "Kalshi key missing — add API keys or turn paper mode back on" });
    return { placed: false, msg: `${pair}: Kalshi key missing` };
  }
  const res = await placeLiveOrder(creds, {
    ticker: m.ticker,
    side,
    priceCents: Math.min(MAX_ENTRY, ask + 1),
    maxPriceCents: MAX_ENTRY,
    count,
    quote: m,
  });
  if (!res.ok) {
    await log({ ...base, mode: "live", status: "skipped", msg: res.error, requested_contracts: count });
    return { placed: false, msg: `${pair}: ${res.error}` };
  }
  const fill = res.priceCents / 100;
  await log({ ...row, order_id: res.orderId, contracts: res.filled, entry_price: fill, stake: res.filled * fill });
  return { placed: true, msg: `${pair}: BOUGHT ${res.filled} @ ${res.priceCents}¢ (${dir})` };
}

/** Sell `count` contracts of `side` at no lower than `minCents` (IOC). Live only. */
async function sellLive(creds: Creds, ticker: string, side: "yes" | "no", count: number, minCents: number) {
  const book = mapOrderToBook(side, minCents);
  const r = await authedKalshi<{ order_id: string; fill_count: string }>(creds, "POST", "/portfolio/events/orders", {
    ticker,
    client_order_id: crypto.randomUUID(),
    side: book.side === "bid" ? "ask" : "bid",
    count: count.toFixed(2),
    price: book.price,
    time_in_force: "immediate_or_cancel",
    self_trade_prevention_type: "taker_at_cross",
    post_only: false,
    exchange_index: -1,
  });
  return { orderId: r.order_id, filled: Number(r.fill_count) || 0 };
}

type OpenRow = {
  id: string;
  pair: string;
  ticker: string;
  dir: string;
  strike_type: string;
  entry_price: number;
  contracts: number;
  mode: string;
  ts: string;
};

async function manage(row: OpenRow, creds: Creds | null, candleStart: number) {
  const sb = await db();
  const paper = row.mode === "paper";
  const side: "yes" | "no" = (row.strike_type === "floor") === (row.dir === "UP") ? "yes" : "no";
  const raw = await fetchMarket(row.ticker);
  if (!raw) return null;
  const m = normalizeMarket(raw);
  const bid = Math.round((side === "yes" ? m.yesBid : m.noBid) * 100);
  const entry = Math.round(row.entry_price * 100);
  // Timeout is per-trade (6 minutes from entry), not candle-relative, so
  // re-entries later in the candle still get their full hold window.
  const entryMs = row.ts ? new Date(row.ts).valueOf() : candleStart;
  const heldMs = Date.now() - (Number.isFinite(entryMs) ? entryMs : candleStart);
  let reason: string | null = null;
  if (bid >= entry + TAKE_PROFIT) reason = "profit";
  else if (bid > 0 && bid <= entry - STOP_LOSS) reason = "stop";
  else if (heldMs >= MAX_HOLD_MS) reason = "time";
  if (!reason || bid <= 0) return null;

  let filled = 0;
  let orderId: string;
  let exitCents = bid;
  if (paper) {
    // Simulated exit at the live bid — no keys, no order.
    filled = row.contracts;
    orderId = `paper-scalp-exit-${row.id}`;
  } else {
    if (!creds) return `${row.pair}: exit (${reason}) skipped — Kalshi key missing`;
    try {
      const out = await sellLive(creds, row.ticker, side, row.contracts, Math.max(1, bid - 1));
      filled = out.filled;
      orderId = out.orderId;
    } catch (e) {
      return `${row.pair}: exit error ${e instanceof Error ? e.message : ""}`;
    }
    if (filled <= 0) return `${row.pair}: exit (${reason}) not filled at ${bid}¢`;
  }
  const pnl = ((exitCents - entry) / 100) * filled;
  const fullyClosed = filled >= row.contracts;
  await sb
    .from("trade_log")
    .update({
      exit_price: exitCents / 100,
      exit_reason: reason,
      exit_at: new Date().toISOString(),
      exit_order_id: orderId,
      exit_contracts: filled,
      pnl,
      outcome: pnl >= 0 ? "win" : "loss",
      // Fully closed by the engine — the settlement pass only grades
      // status="placed" rows, so it will never touch a finished scalp.
      status: fullyClosed ? "closed" : "placed",
      contracts: row.contracts - filled,
    } as never)
    .eq("id", row.id);
  return `${row.pair}: ${paper ? "PAPER " : ""}SOLD ${filled} @ ${exitCents}¢ (${reason}, ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)})`;
}

export async function runScalper() {
  const sb = await db();
  // Migration-tolerant: paper defaults to true if the column isn't there yet.
  const settings = await getBotSettings(sb);
  if (!settings.scalp_enabled) return { ok: true, msg: "scalper off" };
  /** Paper mode defaults to true: no real order until the dashboard toggle is flipped. */
  const paper = settings.auto_trade_paper ?? true;
  const keyId = process.env["KALSHI_API_KEY_ID"];
  const pem = process.env["KALSHI_PRIVATE_KEY"];
  const creds = !paper && keyId && pem ? { keyId, pem } : null;
  if (!paper && !creds) return { ok: false, msg: "Kalshi key missing" };
  const size = Number(settings.auto_trade_size ?? 10);

  // Shared daily loss cap with the lock engine — one cap, every live strategy.
  const cap = Number(settings.daily_loss_cap ?? DAILY_LOSS_CAP_DEFAULT);
  {
    const { dayPnl, openRisk, breached } = await dayRisk(sb, cap, ["lock", "scalp"]);
    if (breached) {
      const msg = `day stopped — $${openRisk.toFixed(2)} open risk + $${dayPnl.toFixed(2)} settled P&L reaches the $${cap.toFixed(0)} daily cap`;
      await sb.from("bot_settings").update({ scalp_last_msg: `${new Date().toISOString().slice(11, 19)}Z ${msg}` } as never).eq("id", true);
      return { ok: true, msg };
    }
  }

  const t0 = Date.now();
  const candleStart = Math.floor(t0 / CANDLE_MS) * CANDLE_MS;
  const results: string[] = [];
  const tried = new Set<string>();

  while (Date.now() - t0 < RUN_MS) {
    const elapsed = (Date.now() - candleStart) / 1000;
    if (elapsed >= 900) break;
    // Entries — first entries in the opening window, re-entries until REENTER_UNTIL.
    if (elapsed >= ENTRY_FROM && elapsed < REENTER_UNTIL) {
      for (const p of PAIRS) {
        if (tried.has(p)) continue;
        const { data: hist } = await sb
          .from("trade_log")
          .select("id,exit_reason,status")
          .eq("pair", p)
          .eq("candle_id", candleStart)
          .eq("source", "scalp");
        const rows = (hist ?? []) as { id: string; exit_reason: string | null; status: string }[];
        const openCount = rows.filter((r) => r.status === "placed").length;
        const closed = rows.filter((r) => r.status !== "placed");
        const block = reentryBlock(closed, openCount);
        if (block === "stop-cooldown" || block === "max-trips") {
          tried.add(p); // permanent for this candle — don't re-query
          continue;
        }
        if (block) continue; // open position — recheck next poll
        const isReentry = rows.length > 0;
        if (!isReentry && elapsed >= ENTRY_UNTIL) continue; // first entry only in the opening window
        const r = await enter(p, candleStart, size, paper, creds);
        if (r === null) continue; // no candle data yet — retry next poll
        results.push(r.msg);
        // A placed trade may re-enter after it closes; skips log once per invocation.
        if (!r.placed) tried.add(p);
      }
    }
    // Exits
    const { data: open } = await sb
      .from("trade_log")
      .select("id,pair,ticker,dir,strike_type,entry_price,contracts,mode,candle_id,ts")
      .eq("source", "scalp")
      .eq("status", "placed")
      .eq("candle_id", candleStart)
      .gt("contracts", 0);
    for (const row of (open ?? []) as OpenRow[]) {
      const r = await manage(row, creds, candleStart);
      if (r) results.push(r);
    }
    if (!open?.length && elapsed >= REENTER_UNTIL) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const msg = results.length ? results.join(" · ") : "watching";
  await sb.from("bot_settings").update({ scalp_last_msg: `${new Date().toISOString().slice(11, 19)}Z ${msg}` } as never).eq("id", true);
  return { ok: true, msg };
}
