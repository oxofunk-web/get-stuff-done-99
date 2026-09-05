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

type Db = Awaited<ReturnType<typeof adminDb>>;

async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface Final {
  pair: string;
  spot: number;
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
  for (const r of (data ?? []) as { pair: string; spot: number; strike: number | null }[]) {
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
  if (!finals.size) return { ok: true, settled: 0, trades: 0 };

  const at = new Date().toISOString();

  const { data: sigs, error } = await db
    .from("signal_log")
    .select("id, pair, dir, strike")
    .eq("candle_id", candleId)
    .is("outcome", null)
    .limit(5000);
  if (error) return { ok: false, settled: 0, trades: 0, error: error.message };

  let settled = 0;
  for (const s of (sigs ?? []) as { id: string; pair: string; dir: string | null; strike: number | null }[]) {
    const spot = finals.get(s.pair);
    const strike = s.strike ?? strikes.get(s.pair) ?? null;
    // Rejected rows carry the direction the engine *would* have taken, so the
    // counterfactual grades exactly like a real trade.
    if (spot == null || strike == null || !s.dir) continue;
    const yesWon = spot >= strike;
    const won = s.dir === "YES" ? yesWon : !yesWon;
    const { error: upErr } = await db
      .from("signal_log")
      .update({ outcome: won ? "win" : "loss", settled_spot: spot, settled_at: at })
      .eq("id", s.id);
    if (!upErr) settled += 1;
  }

  const { data: trades } = await db
    .from("trade_log")
    .select("id, pair, dir, contracts, entry_price, ticker, strike")
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
  }[]) {
    const spot = finals.get(t.pair);
    // New fills carry their exact contract strike. Legacy rows fall back to the
    // old tape-derived value so existing audit history remains settleable.
    const strike = t.strike ?? strikes.get(t.pair) ?? null;
    if (spot == null || strike == null) continue;
    const yesWon = spot >= strike;
    const won = t.dir === "YES" ? yesWon : !yesWon;
    const count = t.contracts ?? 0;
    const entry = t.entry_price ?? 0;
    const pnl = won ? count * (1 - entry) : -count * entry;
    const { error: upErr } = await db
      .from("trade_log")
      .update({ outcome: won ? "win" : "loss", pnl, settled_at: at })
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

  const ids = [...new Set((data ?? []).map((r) => Number((r as { candle_id: number }).candle_id)))]
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
