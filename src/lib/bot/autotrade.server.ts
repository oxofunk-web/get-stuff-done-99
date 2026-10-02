import { directionCall, probCloseAbove, type ProbModel } from "./direction";
import { CALL_WINDOW_SECS, FINAL_SECS, emptyLock, stepLock, type LockState } from "./lock";
import { DAILY_LOSS_CAP_DEFAULT, type PairId } from "./constants";
import type { SpotState } from "./types";
import { dayRisk } from "./loss-cap.server";
import { getBotSettings } from "./settings.server";
import {
  fetchCandleMarketsWithReason,
  normalizeMarket,
  placeLiveOrder,
  type RawMarket,
} from "../kalshi.server";

const CANDLE_MS = 900_000;
const PAIRS: PairId[] = ["BTC", "ETH", "SOL", "XRP"];
const PRODUCT: Record<string, string> = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD" };
/**
 * Entry band for dynamic strike selection: only buy contracts priced
 * 55¢–75¢. Below 55¢ the market says we're likely wrong; above 75¢ the
 * payout doesn't justify the risk.
 */
const MIN_ENTRY_CENTS = 55;
const MAX_ENTRY_CENTS = 75;
/** Minimum expected value (model prob minus ask) before a strike is tradable. */
const MIN_EDGE_CENTS = 10;
const CHASE_CENTS = 3;
const SAMPLE_MS = 2000;
const SAMPLES = 24; // ~48s per run

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function spot(pair: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.exchange.coinbase.com/products/${PRODUCT[pair]}/ticker`, {
      headers: { "User-Agent": "coin-direction-reader" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { price?: string };
    const n = Number(j.price);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function candleOpen(pair: string, start: number): Promise<number | null> {
  const iso = (ms: number) => new Date(ms).toISOString();
  try {
    const r = await fetch(
      `https://api.exchange.coinbase.com/products/${PRODUCT[pair]}/candles?granularity=900&start=${iso(start)}&end=${iso(start + CANDLE_MS)}`,
      { headers: { "User-Agent": "coin-direction-reader" } },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as number[][];
    return rows.find((x) => (x[0] ?? 0) * 1000 === start)?.[3] ?? null;
  } catch {
    return null;
  }
}

/** Extra history so the reader has enough ticks from the first sample. */
async function recentTicks(pair: string): Promise<{ ts: number; price: number }[]> {
  try {
    const r = await fetch(`https://api.exchange.coinbase.com/products/${PRODUCT[pair]}/trades?limit=100`, {
      headers: { "User-Agent": "coin-direction-reader" },
    });
    if (!r.ok) return [];
    const rows = (await r.json()) as { time: string; price: string }[];
    return rows
      .map((t) => ({ ts: new Date(t.time).getTime(), price: Number(t.price) }))
      .filter((t) => Number.isFinite(t.price))
      .sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}

interface StrikePick {
  market: ReturnType<typeof normalizeMarket>;
  side: "yes" | "no";
  askCents: number;
  /** Expected value in cents: model probability minus ask. */
  evCents: number;
}

/**
 * Dynamic strike selection: scan every contract for the active candle and
 * take the strike with the best expected value inside the 55–75¢ band.
 *
 * The pick always expresses the locked direction (the take-profit pass
 * reconstructs the side from strike_type + dir, so a counter-directional
 * pick would be sold on the wrong side). The model's P(close > strike)
 * prices each strike: for a floor contract YES wins above the line, for a
 * cap contract YES wins below it. A pick needs at least MIN_EDGE_CENTS of
 * edge — otherwise we skip instead of forcing it.
 */
export function selectStrike(
  markets: RawMarket[],
  model: ProbModel,
  dir: "UP" | "DOWN",
): { pick: StrikePick | null; note: string } {
  const wantAbove = dir === "UP";
  let best: StrikePick | null = null;
  let bestEv = -Infinity;
  let inBand = 0;
  for (const raw of markets) {
    const m = normalizeMarket(raw);
    if (m.strike == null || !m.strikeType) continue;
    // Same side mapping the take-profit pass uses: floor+UP → yes, cap+UP → no, etc.
    const side: "yes" | "no" = (m.strikeType === "floor") === wantAbove ? "yes" : "no";
    const pUp = probCloseAbove(m.strike, model); // P(close > strike)
    const pWin =
      side === "yes"
        ? m.strikeType === "floor"
          ? pUp
          : 1 - pUp
        : m.strikeType === "floor"
          ? 1 - pUp
          : pUp;
    const ask = side === "yes" ? m.yesAsk : m.noAsk;
    const askCents = Math.round(ask * 100);
    if (!(askCents >= MIN_ENTRY_CENTS && askCents <= MAX_ENTRY_CENTS)) continue;
    inBand++;
    const evCents = (pWin - ask) * 100;
    if (evCents > bestEv) {
      bestEv = evCents;
      best = { market: m, side, askCents, evCents };
    }
  }
  if (!best || best.evCents < MIN_EDGE_CENTS) {
    const note = !inBand
      ? "no strike priced 55–75¢"
      : `best edge ${bestEv.toFixed(1)}¢ below the ${MIN_EDGE_CENTS}¢ minimum`;
    return { pick: null, note };
  }
  return { pick: best, note: "" };
}

/** Exported for unit tests: the paper/live fill decision for one locked call. */
export async function trade(
  pair: PairId,
  dir: "UP" | "DOWN",
  candleStart: number,
  size: number,
  lockSpot: number,
  paper: boolean,
  model: ProbModel | null,
) {
  const sb = await db();
  const { data: existing } = await sb
    .from("trade_log")
    .select("id")
    .eq("pair", pair)
    .eq("candle_id", candleStart)
    .eq("source", "lock")
    .limit(1);
  if (existing?.length) return `${pair}: already traded this candle`;

  const log = async (row: Record<string, unknown>) =>
    sb.from("trade_log").insert({ candle_id: candleStart, pair, dir, mode: "live", source: "lock", ...row } as never);

  const keyId = process.env["KALSHI_API_KEY_ID"];
  const pem = process.env["KALSHI_PRIVATE_KEY"];
  // Paper mode needs no keys; live mode stops here without them.
  if (!paper) {
    if (!keyId || !pem) {
      await log({ status: "skipped", msg: "Kalshi key missing — add API keys or turn paper mode back on" });
      return `${pair}: Kalshi key missing`;
    }
  }



  if (!model) {
    await log({ status: "skipped", msg: "no probability model for strike pricing" });
    return `${pair}: no model`;
  }
  // Dynamic strike selection: scan every contract for this candle and take
  // the best expected value in the 55–75¢ band (replaces the old "nearest
  // strike or skip" behavior).
  const getPick = async () => {
    const { markets, error } = await fetchCandleMarketsWithReason(`KX${pair}15M`);
    if (!markets.length) return { pick: null as StrikePick | null, note: error ?? "no contracts" };
    return selectStrike(markets, model, dir);
  };
  const first = await getPick();
  if (!first.pick) {
    await log({ status: "skipped", msg: `No strike with ≥${MIN_EDGE_CENTS}¢ edge in 55–75¢ — ${first.note}` });
    return `${pair}: no edge (${first.note})`;
  }
  let pick = first.pick;
  const base = { ticker: pick.market.ticker, strike: pick.market.strike, strike_type: pick.market.strikeType };
  const askCents = pick.askCents;
  const edgeNote = `edge +${pick.evCents.toFixed(1)}¢`;
  const count = Math.max(1, Math.floor(size / (askCents / 100)));
  // Paper mode: simulate the fill at the live ask instead of touching Kalshi.
  // No keys needed. The settle pass still grades these rows, so paper P&L is
  // realistic — but they never count toward the live daily loss cap.
  if (paper) {
    const entry = askCents / 100;
    await log({
      ...base,
      mode: "paper",
      status: "placed",
      msg: `PAPER fill ${count} @ ${askCents}¢ ${pick.side.toUpperCase()} (${edgeNote}, tgt ~$${model.driftedPrice.toFixed(2)}) — no real order sent`,
      order_id: `paper-${candleStart}-${pair}`,
      contracts: count,
      requested_contracts: count,
      entry_price: entry,
      stake: count * entry,
    });
    return `${pair}: PAPER FILLED ${count} @ ${askCents}¢ (+${pick.evCents.toFixed(1)}¢ edge)`;
  }
  // Live path only: keys are guaranteed present by the guard at the top of
  // trade(). This second check is for the type-checker, not for logic.
  if (!keyId || !pem) {
    await log({ ...base, status: "skipped", msg: "Kalshi key missing" });
    return `${pair}: Kalshi key missing`;
  }
  // Chase: limit up to CHASE_CENTS above the ask (capped at MAX_ENTRY_CENTS).
  const send = (pk: StrikePick, ask: number) =>
    placeLiveOrder(
      { keyId, pem },
      {
        ticker: pk.market.ticker,
        side: pk.side,
        priceCents: Math.min(MAX_ENTRY_CENTS, ask + CHASE_CENTS),
        maxPriceCents: MAX_ENTRY_CENTS,
        count,
        quote: pk.market,
      },
    );
  let res = await send(pick, askCents);
  if (!res.ok) {
    // One immediate retry: re-scan the fresh book for the best edge.
    const again = await getPick();
    if (again.pick) {
      pick = again.pick;
      res = await send(pick, pick.askCents);
    }
  }
  if (res.ok) {
    const entry = res.priceCents / 100;
    await log({
      ...base,
      status: "placed",
      msg: res.status,
      order_id: res.orderId,
      contracts: res.filled,
      requested_contracts: count,
      entry_price: entry,
      stake: res.filled * entry,
    });
    return `${pair}: FILLED ${res.filled} @ ${res.priceCents}¢`;
  }
  await log({ ...base, status: "skipped", msg: res.error, requested_contracts: count });
  return `${pair}: ${res.error}`;
}

/** One scheduled pass: watch prices ~48s, lock with the same rules, trade on lock. */
export async function runAutoTrade() {
  const sb = await db();
  // Migration-tolerant: paper defaults to true if the column isn't there yet.
  const s = await getBotSettings(sb);
  const stamp = () => new Date().toISOString().slice(11, 19) + "Z";
  const note = async (msg: string) => {
    await sb
      .from("bot_settings")
      .update({ auto_trade_last_msg: `${stamp()} ${msg}` } as never)
      .eq("id", true);
  };
  if (!s?.auto_trade_enabled) {
    await note("auto-trade is OFF — flip AUTO-TRADE on in the dashboard");
    return { ok: true, msg: "auto-trade off" };
  }
  const size = Number(s.auto_trade_size ?? 10);
  /** Paper mode defaults to true: no real order until the dashboard toggle is flipped. */
  const paper = s?.auto_trade_paper ?? true;

  const now0 = Date.now();
  const candleStart = Math.floor(now0 / CANDLE_MS) * CANDLE_MS;
  const elapsed = (now0 - candleStart) / 1000;
  // Start sampling ~50s before the call window so the 20s hold can complete at 5:00.
  if (elapsed < CALL_WINDOW_SECS - 60 || elapsed >= FINAL_SECS) {
    await note("waiting for the trade window — entries only in minutes 5–14 of each 15-min candle");
    return { ok: true, msg: "outside call window" };
  }

  // Daily loss cap: once today's settled live P&L plus open risk reaches the
  // cap, stop trading for the rest of the day.
  const cap = Number(s.daily_loss_cap ?? DAILY_LOSS_CAP_DEFAULT);
  {
    const { dayPnl, openRisk, breached } = await dayRisk(sb, cap, ["lock"]);
    if (breached) {
      const msg = `day stopped — $${openRisk.toFixed(2)} open risk + $${dayPnl.toFixed(2)} settled P&L reaches the $${cap.toFixed(0)} daily cap`;
      await sb
        .from("bot_settings")
        .update({ auto_trade_last_msg: `${new Date().toISOString().slice(11, 19)}Z ${msg}` } as never)
        .eq("id", true);
      return { ok: true, msg };
    }
  }

  const opens: Record<string, number | null> = {};
  const spots: Record<string, SpotState> = {};
  const locks: Record<string, LockState> = {};
  const done = new Set<string>();
  await Promise.all(
    PAIRS.map(async (p) => {
      opens[p] = await candleOpen(p, candleStart);
      const ticks = (await recentTicks(p)).filter((t) => t.ts >= candleStart);
      spots[p] = { price: ticks.at(-1)?.price ?? 0, ticks } as unknown as SpotState;
      locks[p] = emptyLock(candleStart);
    }),
  );

  const results: string[] = [];
  const noFeed = PAIRS.filter((p) => !opens[p]);
  for (let i = 0; i < SAMPLES; i++) {
    const now = Date.now();
    if (now >= candleStart + FINAL_SECS * 1000) break;
    await Promise.all(
      PAIRS.map(async (p) => {
        if (done.has(p) || !opens[p]) return;
        const price = await spot(p);
        if (!price) return;
        const st = spots[p]!;
        const ticks = [...st.ticks, { ts: now, price }].slice(-200);
        spots[p] = { ...st, price, ticks } as SpotState;
        const call = directionCall(p, spots[p], opens[p]!, now);
        const prev = locks[p]!;
        const next = stepLock(prev, call, candleStart, now);
        locks[p] = next;
        if (next.dir && next.lockedAt && next.lockedAt !== prev.lockedAt && !prev.dir) {
          done.add(p);
          await sb.from("direction_calls").upsert(
            {
              pair: p,
              candle_start: candleStart,
              lock_sec: Math.round(next.lockSec ?? 0),
              dir: next.dir,
              prob: next.prob,
              open_price: next.open,
              lock_price: next.lockPrice ?? price,
              locked_at: new Date().toISOString(),
            },
            { onConflict: "pair,candle_start", ignoreDuplicates: true },
          );
          results.push(await trade(p, next.dir, candleStart, size, price, paper, call.model));
        }
      }),
    );
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
  }
  const msg = results.length
    ? results.join(" · ")
    : noFeed.length === PAIRS.length
      ? "price feed down — Coinbase not responding, no trades possible"
      : noFeed.length
        ? `watching, no new lock (no price data for ${noFeed.join(",")})`
        : "watching, no new lock";
  await sb
    .from("bot_settings")
    .update({ auto_trade_last_msg: `${new Date().toISOString().slice(11, 19)}Z ${msg}` } as never)
    .eq("id", true);
  return { ok: true, msg };
}

/** Take-profit: sell a locked-call position once its bid reaches this. */
export const TAKE_PROFIT_CENTS = 93;

/** Watches open locked-call positions ~45s and sells any whose bid is >= 93¢. */
export async function runTakeProfit() {
  const { fetchMarket, placeLiveSell } = await import("../kalshi.server");
  const sb = await db();
  const keyId = process.env["KALSHI_API_KEY_ID"];
  const pem = process.env["KALSHI_PRIVATE_KEY"];
  const candleStart = Math.floor(Date.now() / CANDLE_MS) * CANDLE_MS;
  const out: string[] = [];
  const end = Date.now() + 45_000;
  while (Date.now() < end) {
    const { data: open } = await sb
      .from("trade_log")
      .select("id,pair,dir,mode,ticker,strike_type,contracts,entry_price")
      .eq("source", "lock")
      .eq("status", "placed")
      .eq("candle_id", candleStart)
      .is("exit_at", null);
    if (!open?.length) break;
    for (const t of open) {
      if (!t.ticker || !t.contracts) continue;
      const raw = await fetchMarket(t.ticker);
      if (!raw) continue;
      const m = normalizeMarket(raw);
      const side: "yes" | "no" = (t.strike_type === "floor") === (t.dir === "UP") ? "yes" : "no";
      const bid = Math.round((side === "yes" ? m.yesBid : m.noBid) * 100);
      if (bid < TAKE_PROFIT_CENTS) continue;
      let exit = { price: bid, id: `paper-exit-${t.id}`, n: t.contracts };
      if (t.mode !== "paper") {
        if (!keyId || !pem) continue;
        const r = await placeLiveSell({ keyId, pem }, { ticker: t.ticker, side, priceCents: TAKE_PROFIT_CENTS, count: t.contracts });
        if (!r.ok) { out.push(`${t.pair}: ${r.error}`); continue; }
        exit = { price: r.priceCents, id: r.orderId, n: r.filled };
      }
      const pnl = exit.n * (exit.price / 100 - Number(t.entry_price ?? 0));
      await sb.from("trade_log").update({
        exit_price: exit.price / 100, exit_reason: "take_profit", exit_at: new Date().toISOString(),
        exit_order_id: exit.id, exit_contracts: exit.n,
        ...(exit.n >= t.contracts ? { outcome: "win", pnl, settled_at: new Date().toISOString() } : {}),
      } as never).eq("id", t.id);
      out.push(`${t.pair}: SOLD ${exit.n} @ ${exit.price}¢ (+$${pnl.toFixed(2)})`);
    }
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
  }
  return out;
}
