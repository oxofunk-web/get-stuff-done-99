import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { BANDS, emptyTable, type CalibrationTable } from "./calibration";

/**
 * Telemetry for the trading engine: raw market tape, every signal (fired and
 * rejected), placed orders, and the settled outcome of each candle. All writes
 * go through the privileged server client because the tables are locked down —
 * nothing in the browser can touch them directly.
 */

const snapshotRow = z.object({
  candle_id: z.number(),
  seconds_in: z.number(),
  pair: z.string(),
  ticker: z.string().nullable().optional(),
  spot: z.number(),
  strike: z.number().nullable().optional(),
  yes_bid: z.number().nullable().optional(),
  yes_ask: z.number().nullable().optional(),
  yes_mid: z.number().nullable().optional(),
  spread: z.number().nullable().optional(),
  vol: z.number().nullable().optional(),
});

const signalRow = z.object({
  candle_id: z.number(),
  seconds_in: z.number(),
  pair: z.string(),
  verdict: z.string(),
  reason: z.string().nullable().optional(),
  dir: z.string().nullable().optional(),
  conf: z.number().nullable().optional(),
  calibrated: z.number().nullable().optional(),
  entry_price: z.number().nullable().optional(),
  ev: z.number().nullable().optional(),
  yes_mid: z.number().nullable().optional(),
  spread: z.number().nullable().optional(),
  skew: z.number().nullable().optional(),
  spot_mom: z.number().nullable().optional(),
  k_mom: z.number().nullable().optional(),
  sigma_dist: z.number().nullable().optional(),
  spot: z.number().nullable().optional(),
  strike: z.number().nullable().optional(),
});

const tradeRow = z.object({
  candle_id: z.number(),
  pair: z.string(),
  dir: z.string(),
  mode: z.string(),
  conf: z.number().nullable().optional(),
  calibrated: z.number().nullable().optional(),
  contracts: z.number().nullable().optional(),
  entry_price: z.number().nullable().optional(),
  stake: z.number().nullable().optional(),
  status: z.string(),
  msg: z.string().nullable().optional(),
  order_id: z.string().nullable().optional(),
});

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Batched market tape. Called every few seconds, not every tick. */
export const recordSnapshots = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ rows: z.array(snapshotRow).max(50) }).parse(d))
  .handler(async ({ data }) => {
    if (!data.rows.length) return { ok: true, inserted: 0 };
    const db = await admin();
    const { error } = await db.from("market_snapshots").insert(data.rows);
    if (error) return { ok: false, inserted: 0, error: error.message };
    return { ok: true, inserted: data.rows.length };
  });

/** Every signal decision, fired or rejected. Deduped per candle/pair/second. */
export const recordSignals = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ rows: z.array(signalRow).max(50) }).parse(d))
  .handler(async ({ data }) => {
    if (!data.rows.length) return { ok: true, inserted: 0 };
    const db = await admin();
    const { error } = await db
      .from("signal_log")
      .upsert(data.rows, { onConflict: "candle_id,pair,verdict,seconds_in", ignoreDuplicates: true });
    if (error) return { ok: false, inserted: 0, error: error.message };
    return { ok: true, inserted: data.rows.length };
  });

export const recordTrade = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ row: tradeRow }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db.from("trade_log").insert(data.row);
    return error ? { ok: false, error: error.message } : { ok: true };
  });

/**
 * Mark every unsettled signal and trade of a closed candle win/loss by
 * comparing the settlement spot against the strike. Idempotent: only rows with
 * a null outcome are touched.
 */
export const settleCandle = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        candleId: z.number(),
        finals: z.array(z.object({ pair: z.string(), spot: z.number() })).max(12),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const finals = new Map(data.finals.map((f) => [f.pair, f.spot]));
    const at = new Date().toISOString();

    const { data: sigs, error } = await db
      .from("signal_log")
      .select("id, pair, dir, strike, entry_price")
      .eq("candle_id", data.candleId)
      .is("outcome", null);
    if (error) return { ok: false, settled: 0, error: error.message };

    let settled = 0;
    for (const s of sigs ?? []) {
      const spot = finals.get(s.pair as string);
      if (spot == null || s.strike == null || !s.dir) continue;
      const yesWon = spot >= (s.strike as number);
      const won = s.dir === "YES" ? yesWon : !yesWon;
      await db
        .from("signal_log")
        .update({ outcome: won ? "win" : "loss", settled_spot: spot, settled_at: at })
        .eq("id", s.id as string);
      settled += 1;
    }

    const { data: trades } = await db
      .from("trade_log")
      .select("id, pair, dir, contracts, entry_price")
      .eq("candle_id", data.candleId)
      .is("outcome", null)
      .eq("status", "placed");
    for (const t of trades ?? []) {
      const spot = finals.get(t.pair as string);
      if (spot == null) continue;
      const { data: sig } = await db
        .from("signal_log")
        .select("strike")
        .eq("candle_id", data.candleId)
        .eq("pair", t.pair as string)
        .not("strike", "is", null)
        .limit(1)
        .maybeSingle();
      const strike = sig?.strike as number | null | undefined;
      if (strike == null) continue;
      const yesWon = spot >= strike;
      const won = t.dir === "YES" ? yesWon : !yesWon;
      const count = (t.contracts as number) ?? 0;
      const entry = (t.entry_price as number) ?? 0;
      const pnl = won ? count * (1 - entry) : -count * entry;
      await db
        .from("trade_log")
        .update({ outcome: won ? "win" : "loss", pnl, settled_at: at })
        .eq("id", t.id as string);
    }

    return { ok: true, settled };
  });

export interface AccuracyStats {
  ok: boolean;
  total: number;
  wins: number;
  winRate: number;
  table: CalibrationTable;
  byPair: { pair: string; n: number; wins: number }[];
  byMinute: { minute: number; n: number; wins: number }[];
  recent: { ts: string; pair: string; dir: string; conf: number; outcome: string }[];
  error?: string;
}

/** Real, settled accuracy — the source for both the panel and calibration. */
export const getAccuracy = createServerFn({ method: "GET" }).handler(async (): Promise<AccuracyStats> => {
  const empty: AccuracyStats = {
    ok: false,
    total: 0,
    wins: 0,
    winRate: 0,
    table: emptyTable(),
    byPair: [],
    byMinute: [],
    recent: [],
  };
  try {
    const db = await admin();
    const { data, error } = await db
      .from("signal_log")
      .select("ts, pair, dir, conf, seconds_in, outcome")
      .eq("verdict", "fired")
      .not("outcome", "is", null)
      .order("ts", { ascending: false })
      .limit(5000);
    if (error) return { ...empty, error: error.message };

    const rows = (data ?? []) as {
      ts: string;
      pair: string;
      dir: string;
      conf: number | null;
      seconds_in: number | null;
      outcome: string;
    }[];

    const table = emptyTable();
    const pairMap = new Map<string, { n: number; wins: number }>();
    const minMap = new Map<number, { n: number; wins: number }>();
    let wins = 0;

    for (const r of rows) {
      const won = r.outcome === "win";
      if (won) wins += 1;
      const conf = r.conf ?? 0;
      const band = table.find((b) => conf >= b.lo && conf < b.hi);
      if (band) {
        band.n += 1;
        if (won) band.wins += 1;
      }
      const p = pairMap.get(r.pair) ?? { n: 0, wins: 0 };
      p.n += 1;
      if (won) p.wins += 1;
      pairMap.set(r.pair, p);

      const minute = Math.floor((r.seconds_in ?? 0) / 60);
      const m = minMap.get(minute) ?? { n: 0, wins: 0 };
      m.n += 1;
      if (won) m.wins += 1;
      minMap.set(minute, m);
    }

    return {
      ok: true,
      total: rows.length,
      wins,
      winRate: rows.length ? (wins / rows.length) * 100 : 0,
      table,
      byPair: [...pairMap.entries()].map(([pair, v]) => ({ pair, ...v })).sort((a, b) => b.n - a.n),
      byMinute: [...minMap.entries()]
        .map(([minute, v]) => ({ minute, ...v }))
        .sort((a, b) => a.minute - b.minute),
      recent: rows.slice(0, 12).map((r) => ({
        ts: r.ts,
        pair: r.pair,
        dir: r.dir,
        conf: r.conf ?? 0,
        outcome: r.outcome,
      })),
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "telemetry unavailable" };
  }
});

/** Exported so the tuner can replay recorded books instead of synthetic ones. */
export const exportSnapshots = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ hours: z.number().min(1).max(240) }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const since = new Date(Date.now() - data.hours * 3600_000).toISOString();
    const { data: rows, error } = await db
      .from("market_snapshots")
      .select("*")
      .gte("ts", since)
      .order("ts", { ascending: true })
      .limit(50000);
    if (error) return { ok: false, rows: [], error: error.message };
    return { ok: true, rows: rows ?? [] };
  });

export const CONF_BANDS = BANDS;
