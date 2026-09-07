/**
 * Candle settlement.
 *
 * Grading used to depend on a browser tab being open at the exact second a
 * 15-minute candle rolled over. Anything missed was never graded. This module
 * resolves the settlement spot from the recorded tape (`market_snapshots`)
 * instead, so a scheduled pass can grade every stale candle whether or not
 * anyone is watching. Every step is idempotent: only rows with a null outcome
 * are touched.
 */
import { candleInfo } from "./candle";
import { fetchFinalizedMarketResult } from "../kalshi.server";

type Db = Awaited<ReturnType<typeof adminDb>>;

async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface Final {
  pair: string;
  spot: number;
}

export function gradeContract(
  dir: "YES" | "NO",
  finalSpot: number,
  strike: number,
  strikeType: "floor" | "cap" = "floor",
) {
  const yesWon = strikeType === "floor" ? finalSpot >= strike : finalSpot <= strike;
  return dir === "YES" ? yesWon : !yesWon;
}

/** Last recorded spot (and strike) per pair for a candle, straight off the tape. */
export async function finalsFromTape(db: Db, candleId: number) {
  const { data } = await db
    .from("market_snapshots")
    .select("pair, spot, strike, seconds_in")
    .eq("candle_id", candleId)
    .order("seconds_in", { ascending: false })
    .limit(2000);

  const finals = new Map<string, number>();
  const strikes = new Map<string, number>();
  for (const r of (data ?? []) as { pair: string; spot: number; strike: number | null; seconds_in: number }[]) {
    // A mid-candle observation is not a settlement price. Leave the shadow row
    // ungraded unless the tape reached the final 30 seconds of the contract.
    if (r.seconds_in < 870) continue;
    if (!finals.has(r.pair) && Number.isFinite(r.spot) && r.spot > 0) finals.set(r.pair, r.spot);
    if (!strikes.has(r.pair) && r.strike != null) strikes.set(r.pair, r.strike);
  }
  return { finals, strikes };
}

/**
 * Grade one candle. `override` is the fast path used by the live client at
 * rollover; without it the settlement spot comes from the tape.
 */
export async function settleOne(candleId: number, override?: Final[]) {
  const db = await adminDb();
  const { finals: taped, strikes } = await finalsFromTape(db, candleId);
  const finals = new Map(taped);
  for (const f of override ?? []) if (f.spot > 0) finals.set(f.pair, f.spot);

  const at = new Date().toISOString();

  const { data: sigs, error } = finals.size
    ? await db
        .from("signal_log")
        .select("id, pair, dir, strike, strike_type")
        .eq("candle_id", candleId)
        .is("outcome", null)
        .limit(5000)
    : { data: [], error: null };
  if (error) return { ok: false, settled: 0, trades: 0, voided: 0, error: error.message };

  let settled = 0;
  for (const s of (sigs ?? []) as { id: string; pair: string; dir: string | null; strike: number | null; strike_type: "floor" | "cap" | null }[]) {
    const spot = finals.get(s.pair);
    const strike = s.strike ?? strikes.get(s.pair) ?? null;
    // Rejected rows carry the direction the engine *would* have taken, so the
    // counterfactual grades exactly like a real trade.
    // Shadow results may use the local tape, but stale/legacy rows without an
    // explicit contract rule are never allowed to train the live engine.
    if (spot == null || strike == null || !s.dir || !s.strike_type) continue;
    const won = gradeContract(s.dir as "YES" | "NO", spot, strike, s.strike_type);
    const { error: upErr } = await db
      .from("signal_log")
      .update({ outcome: won ? "win" : "loss", settled_spot: spot, settled_at: at })
      .eq("id", s.id);
    if (!upErr) settled += 1;
  }

  const { data: trades } = await db
    .from("trade_log")
    .select("id, pair, dir, contracts, entry_price, ticker, strike, strike_type")
    .eq("candle_id", candleId)
    .is("outcome", null)
    .eq("status", "placed")
    .limit(500);

  let graded = 0;
  for (const t of (trades ?? []) as {
    id: string;
    pair: string;
    dir: string;
    contracts: number | null;
    entry_price: number | null;
    ticker: string | null;
    strike: number | null;
    strike_type: "floor" | "cap" | null;
  }[]) {
    if (!t.ticker) continue;
    const final = await fetchFinalizedMarketResult(t.ticker);
    if (!final) continue;
    const won = t.dir === "YES" ? final.result === "yes" : final.result === "no";
    const count = t.contracts ?? 0;
    const entry = t.entry_price ?? 0;
    const pnl = won ? count * (1 - entry) : -count * entry;
    const { error: upErr } = await db
      .from("trade_log")
      .update({
        outcome: won ? "win" : "loss",
        pnl,
        settled_at: at,
        strike: t.strike ?? final.strike,
        strike_type: t.strike_type ?? final.strikeType,
      })
      .eq("id", t.id);
    if (!upErr) graded += 1;
  }

  return { ok: true, settled, trades: graded };
}

/**
 * Grade every candle that has already closed and still holds ungraded rows.
 * Bounded per run and safe to re-run: finished rows are skipped by the null
 * outcome filter.
 */
export async function settlePending(maxCandles = 12) {
  const db = await adminDb();
  const current = candleInfo(Date.now()).id;

  const { data, error } = await db
    .from("signal_log")
    .select("candle_id")
    .is("outcome", null)
    .not("dir", "is", null)
    .lt("candle_id", current)
    .order("candle_id", { ascending: false })
    .limit(5000);
  if (error) return { ok: false, candles: 0, settled: 0, trades: 0, error: error.message };

  const { data: pendingTrades } = await db
    .from("trade_log")
    .select("candle_id")
    .eq("status", "placed")
    .is("outcome", null)
    .lt("candle_id", current)
    .limit(5000);

  const ids = [...new Set([...(data ?? []), ...(pendingTrades ?? [])].map((r) => Number((r as { candle_id: number }).candle_id)))]
    .sort((a, b) => b - a)
    .slice(0, maxCandles);

  let settled = 0;
  let trades = 0;
  for (const id of ids) {
    const r = await settleOne(id);
    settled += r.settled;
    trades += r.trades;
  }
  return { ok: true, candles: ids.length, settled, trades };
}
