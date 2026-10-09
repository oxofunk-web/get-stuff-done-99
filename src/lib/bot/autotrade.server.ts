import { directionCall, probCloseAbove, type ProbModel } from "./direction";
import { CALL_WINDOW_SECS, FINAL_SECS, LOCK_FORM_END_SECS, emptyLock, stepLock, type LockState } from "./lock";
import { DAILY_LOSS_CAP_DEFAULT, FX_PAIRS, isFx, type PairId } from "./constants";
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
const BASE_PAIRS: PairId[] = ["BTC", "ETH", "SOL", "XRP", ...FX_PAIRS];
/** Forex alerts size at a flat $10 per trade. */
const FX_SIZE = 10;
/** DOGE is paper-only and joins only after its feeds verify (see dogeReady). */
const EXTRA_PAIRS: PairId[] = ["DOGE"];
/**
 * Entry band for dynamic strike selection: only buy contracts priced
 * 50¢–85¢. Below 50¢ the market says we're likely wrong; above 85¢ the
 * payout doesn't justify the risk.
 */
const MIN_ENTRY_CENTS = 50;
const MAX_ENTRY_CENTS = 85;
/** Paper-only wider band; the Bank net-edge filter remains the final gate. */
export const PAPER_BAND = { min: 50, max: 80 } as const;
const LIVE_BAND = { min: MIN_ENTRY_CENTS, max: MAX_ENTRY_CENTS } as const;

let dogeCheck: { at: number; ok: boolean; why: string } | null = null;
/** Verify Coinbase DOGE-USD ticks and KXDOGE15M lists markets with strikes. Cached 10 min per worker. */
async function dogeReady(): Promise<{ ok: boolean; why: string }> {
  if (dogeCheck && Date.now() - dogeCheck.at < 600_000) return dogeCheck;
  let ok = false;
  let why = "";
  try {
    const t = await fetch("https://api.exchange.coinbase.com/products/DOGE-USD/ticker", {
      headers: { "User-Agent": "coin-direction-reader" },
      signal: AbortSignal.timeout(5000),
    });
    const j = t.ok ? ((await t.json()) as { price?: string }) : {};
    if (!(Number(j.price) > 0)) why = `Coinbase DOGE-USD ticker failed (${t.status})`;
    else {
      const { markets, error } = await fetchCandleMarketsWithReason("KXDOGE15M");
      const withStrike = markets.filter((m) => normalizeMarket(m).strike != null);
      if (!withStrike.length) why = `KXDOGE15M has no markets with strikes${error ? ` (${error})` : ""}`;
      else ok = true;
    }
  } catch (e) {
    why = `DOGE check error: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!ok) console.warn(`[autotrade] DOGE disabled, running original four: ${why}`);
  dogeCheck = { at: Date.now(), ok, why };
  return dogeCheck;
}
/** Minimum expected value (model prob minus ask) before a strike is tradable. */
const MIN_EDGE_CENTS = 5;
const CHASE_CENTS = 2; // never chase more than 2¢ past the scored price
const SAMPLE_MS = 2000;
const SAMPLES = 24; // ~48s per run

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** The first lock formed in minutes 0–5 of this candle — it owns the coin for the candle. */
async function firstLock(
  sb: Awaited<ReturnType<typeof db>>,
  pair: string,
  candleStart: number,
): Promise<{ id: string; dir: "UP" | "DOWN" } | null> {
  const { data } = await sb
    .from("direction_calls")
    .select("id,dir")
    .eq("pair", pair)
    .eq("candle_start", candleStart)
    .lte("lock_sec", LOCK_FORM_END_SECS)
    .order("locked_at", { ascending: true })
    .limit(1);
  const r = data?.[0];
  return r && (r.dir === "UP" || r.dir === "DOWN") ? { id: r.id, dir: r.dir } : null;
}

/** Which provider served each read this run, per pair (for the dashboard status). */
const feedUsed = new Map<string, Set<string>>();
const mark = (pair: string, provider?: string) => {
  if (!provider) return;
  (feedUsed.get(pair) ?? feedUsed.set(pair, new Set()).get(pair)!).add(provider);
};

async function spot(pair: string): Promise<number | null> {
  const { spotWithProvider } = await import("./feed.server");
  const r = await spotWithProvider(pair);
  mark(pair, r?.provider);
  return r?.value ?? null;
}

async function candleOpen(pair: string, start: number): Promise<number | null> {
  const { candleOpenWithProvider } = await import("./feed.server");
  const r = await candleOpenWithProvider(pair, start);
  mark(pair, r?.provider);
  return r?.value ?? null;
}

/** Extra history so the reader has enough ticks from the first sample. */
async function recentTicks(pair: string): Promise<{ ts: number; price: number }[]> {
  const { recentTradesWithProvider } = await import("./feed.server");
  const r = await recentTradesWithProvider(pair);
  mark(pair, r?.provider);
  return r?.value ?? [];
}

/** "feed: coinbase" or e.g. "feed: coinbase · ETH kraken" when a pair fell back. */
function feedSummary(): string {
  const fallbacks = [...feedUsed].filter(([, s]) => [...s].some((p) => p !== "coinbase"));
  if (!feedUsed.size) return "";
  if (!fallbacks.length) return " · feed: coinbase";
  return ` · feed: ${fallbacks.map(([pair, s]) => `${pair} ${[...s].join("+")}`).join(", ")}`;
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
 * take the strike with the best expected value inside the 50–85¢ band.
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
  band: { min: number; max: number } = LIVE_BAND,
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
    if (!(askCents >= band.min && askCents <= band.max)) continue;
    inBand++;
    const evCents = (pWin - ask) * 100;
    if (evCents > bestEv) {
      bestEv = evCents;
      best = { market: m, side, askCents, evCents };
    }
  }
  if (!best || best.evCents < MIN_EDGE_CENTS) {
    const note = !inBand
      ? `no strike priced ${band.min}–${band.max}¢`
      : `best edge ${bestEv.toFixed(1)}¢ below the ${MIN_EDGE_CENTS}¢ minimum`;
    return { pick: null, note };
  }
  return { pick: best, note: "" };
}

/** Kalshi round-trip fees per contract, in dollars. */
export const PAPER_FEE = 0.14;

/** Paper-only quarter-Kelly sizing against the paper bankroll, net of fees. */
export function bankSize(evCents: number, askCents: number, bankroll: number) {
  const q = askCents / 100;
  const pWin = evCents / 100 + q;
  const W = 1 - q - PAPER_FEE;
  const L = q + PAPER_FEE;
  const net = pWin * W - (1 - pWin) * L;
  const netEdgeCents = net * 100;
  if (!(net >= 0.02) || W <= 0 || bankroll <= 0) {
    return { ok: false as const, msg: `Bank: net edge ${netEdgeCents.toFixed(1)}¢ below 2¢ minimum`, netEdgeCents };
  }
  const f = net / (W * L);
  const sizeDollars = bankroll * f * 0.25;
  let contracts = Math.max(1, Math.floor(sizeDollars / q));
  const maxByStake = Math.floor((bankroll * 0.25) / q);
  contracts = Math.min(contracts, maxByStake);
  if (contracts < 1) {
    return { ok: false as const, msg: `Bank: $${bankroll.toFixed(2)} too small for 1 contract under 25% cap`, netEdgeCents };
  }
  return { ok: true as const, contracts, netEdgeCents, f };
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
  /** Paper bankroll for Kelly sizing; when omitted, paper falls back to flat sizing. */
  paperBankroll?: number,
  /** Lock provenance + order-time re-confirmation (the server loop always passes this). */
  lock?: {
    lockId: string | null;
    reconfirm: () => Promise<{ dir: "UP" | "DOWN"; prob: number } | null>;
  },
) {
  const sb = await db();
  const { data: existing } = await sb
    .from("trade_log")
    .select("id")
    .eq("pair", pair)
    .eq("candle_id", candleStart)
    .eq("source", "lock")
    // Only a real fill blocks the candle. A skip row (no strike, key error,
    // no fill) must not lock the pair out for the remaining minutes.
    .eq("status", "alert")
    .limit(1);
  if (existing?.length) return `${pair}: alert already raised this candle`;

  // Every decision — fill or skip — must persist. If the insert itself fails,
  // surface that in the run message instead of vanishing silently.
  const log = async (row: Record<string, unknown>) => {
    const { error } = await sb
      .from("trade_log")
      .insert({ candle_id: candleStart, pair, dir, mode: "live", source: "lock", tp_trigger: tpTriggerFor(pair), lock_id: lock?.lockId ?? null, ...row } as never);
    if (error) console.error(`[autotrade] trade_log insert failed for ${pair}: ${error.message}`);
    return error;
  };

  /** Order-time gate: a live lock row must exist for this coin/candle/direction and the signal must still hold ≥70%. */
  const confirmLock = async (): Promise<string | null> => {
    if (!lock) return null;
    if (!lock.lockId) return "no live lock";
    const row = await firstLock(sb, pair, candleStart);
    if (!row || row.id !== lock.lockId || row.dir !== dir) return "no live lock";
    const now = await lock.reconfirm();
    if (!now || now.dir !== dir || now.prob < 70) {
      return `lock decayed before fill${now ? ` (now ${now.dir} ${now.prob.toFixed(0)}%)` : " (no fresh price)"}`;
    }
    return null;
  };





  if (!model) {
    await log({ status: "skipped", msg: "no probability model for strike pricing" });
    return `${pair}: no model`;
  }
  // Dynamic strike selection: scan every contract for this candle and take
  // the best expected value in the 50–85¢ band (replaces the old "nearest
  // strike or skip" behavior).
  const getPick = async () => {
    const { markets, error } = await fetchCandleMarketsWithReason(`KX${pair}15M`);
    if (!markets.length) return { pick: null as StrikePick | null, note: error ?? "no contracts" };
    return selectStrike(markets, model, dir, paper ? PAPER_BAND : LIVE_BAND);
  };
  const first = await getPick();
  if (!first.pick) {
    await log({ status: "skipped", msg: `No strike with ≥${MIN_EDGE_CENTS}¢ edge in ${paper ? "50–80" : "50–85"}¢ — ${first.note}`, requested_contracts: 0 });
    return `${pair}: no edge (${first.note})`;
  }
  let pick = first.pick;
  const base = { ticker: pick.market.ticker, strike: pick.market.strike, strike_type: pick.market.strikeType };
  const askCents = pick.askCents;
  const edgeNote = `edge +${pick.evCents.toFixed(1)}¢`;
  const flatCount = Math.max(1, Math.floor(size / (askCents / 100)));
  const count = flatCount;
  /** Attempted price/size, stamped on every skip so missed trades are measurable. */
  const attempt = { entry_price: askCents / 100, requested_contracts: count };
  {
    const why = await confirmLock();
    if (why) {
      await log({ ...base, ...attempt, ...(paper ? { mode: "paper" } : {}), status: "skipped", msg: why });
      return `${pair}: ${why}`;
    }
  }
  // MANUAL mode: no order is ever sent. The qualified setup is written as an
  // alert row for the TRADE ALERTS panel and the bot stops there.
  const minsLeft = Math.max(0, (candleStart + FINAL_SECS * 1000 - Date.now()) / 60_000);
  await log({
    ...base,
    mode: "manual",
    status: "alert",
    msg: `ALERT ${dir} · ${pick.side.toUpperCase()} @ ${askCents}¢ · ${edgeNote} · ~${count} contracts ($${(count * askCents / 100).toFixed(2)}) · ${minsLeft.toFixed(1)} min left — no order sent`,
    entry_price: askCents / 100,
    requested_contracts: count,
    stake: (count * askCents) / 100,
  });
  return `${pair}: ALERT ${dir} @ ${askCents}¢ (+${pick.evCents.toFixed(1)}¢ edge)`;
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
      .update({ auto_trade_last_msg: `${stamp()} ${msg}`, last_tick_at: new Date().toISOString() } as never)
      .eq("id", true);
  };
  const size = Number(s.auto_trade_size ?? 10);
  /** Paper mode defaults to true: no real order until the dashboard toggle is flipped. */
  const paper = s?.auto_trade_paper ?? true;

  const now0 = Date.now();
  const candleStart = Math.floor(now0 / CANDLE_MS) * CANDLE_MS;
  const elapsed = (now0 - candleStart) / 1000;
  // Minutes 0–5: locks form. Minutes 5–14: trade the locked call. Last minute: nothing.
  if (elapsed >= FINAL_SECS) {
    await note("waiting for the next candle — locks form in minutes 0–5, entries in minutes 5–14");
    return { ok: true, msg: "outside call window" };
  }

  // DOGE: paper only, and only after its Coinbase + Kalshi feeds verify; otherwise the original four run unchanged.
  const doge = paper ? await dogeReady() : { ok: false, why: "live mode" };
  const PAIRS: PairId[] = doge.ok ? [...BASE_PAIRS, ...EXTRA_PAIRS] : BASE_PAIRS;
  const dogeNote = paper && !doge.ok ? ` · DOGE off: ${doge.why}` : "";
  feedUsed.clear();
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
  // The first lock recorded for this candle (server or dashboard) owns the coin.
  const lockRows: Record<string, { id: string; dir: "UP" | "DOWN" }> = {};
  for (const p of PAIRS) {
    const r = await firstLock(sb, p, candleStart);
    if (r) lockRows[p] = r;
  }
  for (let i = 0; i < SAMPLES; i++) {
    const now = Date.now();
    if (now >= candleStart + FINAL_SECS * 1000) break;
    const el = (now - candleStart) / 1000;
    // Nothing left to do: every coin traded this run, or past 5:00 with no lock.
    if (el > LOCK_FORM_END_SECS && PAIRS.every((p) => done.has(p) || !lockRows[p])) break;
    await Promise.all(
      PAIRS.map(async (p) => {
        if (done.has(p) || !opens[p]) return;
        if (!lockRows[p] && el > LOCK_FORM_END_SECS) return; // sits out this candle
        const price = await spot(p);
        if (!price) return;
        const st = spots[p]!;
        const ticks = [...st.ticks, { ts: now, price }].slice(-200);
        spots[p] = { ...st, price, ticks } as SpotState;
        const call = directionCall(p, spots[p], opens[p]!, now);
        if (!lockRows[p]) {
          const prev = locks[p]!;
          const next = stepLock(prev, call, candleStart, now);
          locks[p] = next;
          if (next.dir && next.lockedAt && !prev.dir) {
            // Every lock is its own row; never overwrite an earlier lock.
            const { error: lockErr } = await sb.from("direction_calls").insert({
              pair: p,
              candle_start: candleStart,
              lock_sec: Math.round(next.lockSec ?? 0),
              dir: next.dir,
              prob: next.prob,
              open_price: next.open,
              lock_price: next.lockPrice ?? price,
              locked_at: new Date().toISOString(),
            });
            if (lockErr) console.error(`[autotrade] direction_calls insert failed for ${p}: ${lockErr.message}`);
            const r = await firstLock(sb, p, candleStart);
            if (r) {
              lockRows[p] = r;
              results.push(`${p}: LOCKED ${r.dir}`);
            }
          }
          return;
        }
        // Entry window: trade only the locked call, once per run.
        if (el < CALL_WINDOW_SECS) return;
        done.add(p);
        const lr = lockRows[p]!;
        const reconfirm = async () => {
          const px = await spot(p);
          if (!px) return null;
          const st2 = spots[p]!;
          const t2 = Date.now();
          const s2 = { ...st2, price: px, ticks: [...st2.ticks, { ts: t2, price: px }].slice(-200) } as SpotState;
          const c2 = directionCall(p, s2, opens[p]!, t2);
          return { dir: c2.dir, prob: c2.prob };
        };
        results.push(
          await trade(p, lr.dir, candleStart, isFx(p) ? FX_SIZE : size, price, paper, call.model, paper ? Number(s.paper_bankroll ?? 100) : undefined, {
            lockId: lr.id,
            reconfirm,
          }),
        );
      }),
    );
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
  }
  const msg = results.length
    ? results.join(" · ")
    : noFeed.length === PAIRS.length
      ? "price feed down — Coinbase, Kraken and Binance.US all failed, no trades possible"
      : noFeed.length
        ? `watching, no new lock (no price data for ${noFeed.join(",")})`
        : "watching, no new lock";
  const fullMsg = msg + feedSummary() + dogeNote;
  await sb
    .from("bot_settings")
    .update({ auto_trade_last_msg: `${new Date().toISOString().slice(11, 19)}Z ${fullMsg}`, last_tick_at: new Date().toISOString() } as never)
    .eq("id", true);
  return { ok: true, msg: fullMsg };
}

/** Take-profit: sell a locked-call position once its bid reaches this. */
export const TAKE_PROFIT_CENTS = 93;

/** A/B test: per-coin take-profit triggers (cents). Edit here when the test ends. */
export const TP_TRIGGER_BY_PAIR: Record<string, number> = {
  BTC: 93, XRP: 93, // control
  ETH: 95, SOL: 95, DOGE: 95, // treatment
};
export const tpTriggerFor = (pair: string) => TP_TRIGGER_BY_PAIR[pair] ?? TAKE_PROFIT_CENTS;

/** Watches open locked-call positions ~45s and sells any whose bid is >= its coin's trigger. */
