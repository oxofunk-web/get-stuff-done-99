import { directionCall } from "./direction";
import { CALL_WINDOW_SECS, FINAL_SECS, emptyLock, stepLock, type LockState } from "./lock";
import type { PairId } from "./constants";
import type { SpotState } from "./types";
import { fetchOpenMarketWithReason, normalizeMarket, placeLiveOrder } from "../kalshi.server";

const CANDLE_MS = 900_000;
const PAIRS: PairId[] = ["BTC", "ETH", "SOL", "XRP"];
const PRODUCT: Record<string, string> = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD" };
const MAX_ENTRY_CENTS = 99;
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

async function trade(pair: PairId, dir: "UP" | "DOWN", candleStart: number, size: number, lockSpot: number) {
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
  if (!keyId || !pem) {
    await log({ status: "skipped", msg: "Kalshi key missing" });
    return `${pair}: Kalshi key missing`;
  }

  // No daily loss cap on locked-call trades: every locked call is allowed to trade.



  const { market: raw, error } = await fetchOpenMarketWithReason(`KX${pair}15M`, lockSpot);
  if (!raw) {
    await log({ status: "skipped", msg: `No Kalshi contract: ${error}` });
    return `${pair}: ${error}`;
  }
  const m = normalizeMarket(raw);
  if (m.strike == null || !m.strikeType) {
    await log({ status: "skipped", msg: "Contract has no line", ticker: m.ticker });
    return `${pair}: no line`;
  }
  // floor: YES = finishes above the line. cap: YES = finishes below the line.
  const wantAbove = dir === "UP";
  const side: "yes" | "no" = (m.strikeType === "floor") === wantAbove ? "yes" : "no";
  const onSide = wantAbove ? lockSpot > m.strike : lockSpot < m.strike;
  const base = { ticker: m.ticker, strike: m.strike, strike_type: m.strikeType };
  if (!onSide) {
    await log({ ...base, status: "skipped", msg: `Price is on the wrong side of Kalshi's line ${m.strike}` });
    return `${pair}: wrong side of line`;
  }
  const askCents = Math.round((side === "yes" ? m.yesAsk : m.noAsk) * 100);
  if (!askCents || askCents > MAX_ENTRY_CENTS) {
    await log({ ...base, status: "skipped", msg: `Contract costs ${askCents}¢ (max ${MAX_ENTRY_CENTS}¢)` });
    return `${pair}: too expensive`;
  }
  const count = Math.max(1, Math.floor(size / (askCents / 100)));
  // Chase: limit up to CHASE_CENTS above the ask (capped at MAX_ENTRY_CENTS).
  const send = (q: typeof m, ask: number) =>
    placeLiveOrder(
      { keyId, pem },
      {
        ticker: m.ticker,
        side,
        priceCents: Math.min(MAX_ENTRY_CENTS, ask + CHASE_CENTS),
        maxPriceCents: MAX_ENTRY_CENTS,
        count,
        quote: q,
      },
    );
  let res = await send(m, askCents);
  if (!res.ok) {
    // One immediate retry against a fresh book.
    const again = await fetchOpenMarketWithReason(`KX${pair}15M`, lockSpot);
    if (again.market) {
      const m2 = normalizeMarket(again.market);
      if (m2.ticker === m.ticker) {
        const ask2 = Math.round((side === "yes" ? m2.yesAsk : m2.noAsk) * 100);
        if (ask2 && ask2 <= MAX_ENTRY_CENTS) res = await send(m2, ask2);
      }
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
  const { data: s } = await sb
    .from("bot_settings")
    .select("auto_trade_enabled,auto_trade_size")
    .eq("id", true)
    .maybeSingle();
  if (!s?.auto_trade_enabled) return { ok: true, msg: "auto-trade off" };
  const size = Number(s.auto_trade_size ?? 10);

  const now0 = Date.now();
  const candleStart = Math.floor(now0 / CANDLE_MS) * CANDLE_MS;
  const elapsed = (now0 - candleStart) / 1000;
  // Start sampling ~50s before the call window so the 20s hold can complete at 10:00.
  if (elapsed < CALL_WINDOW_SECS - 60 || elapsed >= FINAL_SECS) return { ok: true, msg: "outside call window" };

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
          results.push(await trade(p, next.dir, candleStart, size, price));
        }
      }),
    );
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
  }
  const msg = results.length ? results.join(" · ") : "watching, no new lock";
  await sb
    .from("bot_settings")
    .update({ auto_trade_last_msg: `${new Date().toISOString().slice(11, 19)}Z ${msg}` } as never)
    .eq("id", true);
  return { ok: true, msg };
}
