import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { BANDS, emptyTable, type CalibrationTable, type PairCalibration } from "./calibration";

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
  ticker: z.string().nullable().default(null),
  spot: z.number(),
  strike: z.number().nullable().default(null),
  yes_bid: z.number().nullable().default(null),
  yes_ask: z.number().nullable().default(null),
  yes_mid: z.number().nullable().default(null),
  spread: z.number().nullable().default(null),
  vol: z.number().nullable().default(null),
});

const signalRow = z.object({
  candle_id: z.number(),
  seconds_in: z.number(),
  pair: z.string(),
  verdict: z.string(),
  reason: z.string().nullable().default(null),
  dir: z.string().nullable().default(null),
  conf: z.number().nullable().default(null),
  calibrated: z.number().nullable().default(null),
  entry_price: z.number().nullable().default(null),
  ev: z.number().nullable().default(null),
  yes_mid: z.number().nullable().default(null),
  spread: z.number().nullable().default(null),
  skew: z.number().nullable().default(null),
  spot_mom: z.number().nullable().default(null),
  k_mom: z.number().nullable().default(null),
  sigma_dist: z.number().nullable().default(null),
  spot: z.number().nullable().default(null),
  strike: z.number().nullable().default(null),
  source: z.enum(["client", "server"]).default("client"),
});

const tradeRow = z.object({
  candle_id: z.number(),
  pair: z.string(),
  dir: z.string(),
  mode: z.string(),
  conf: z.number().nullable().default(null),
  calibrated: z.number().nullable().default(null),
  contracts: z.number().nullable().default(null),
  entry_price: z.number().nullable().default(null),
  stake: z.number().nullable().default(null),
  status: z.string(),
  msg: z.string().nullable().default(null),
  order_id: z.string().nullable().default(null),
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
 * Fast-path grading for the candle that just closed, called by the live client
 * at rollover. The scheduled `/api/public/settle` pass is the safety net when
 * no tab is open; both share the same idempotent core.
 */
export const settleCandle = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        candleId: z.number(),
        finals: z.array(z.object({ pair: z.string(), spot: z.number() })).max(12).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { settleOne } = await import("./settle.server");
    return settleOne(data.candleId, data.finals);
  });

/** Backfill pass usable from the app, same core as the scheduled route. */
export const settleBacklog = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ maxCandles: z.number().min(1).max(48).default(12) }).parse(d))
  .handler(async ({ data }) => {
    const { settlePending } = await import("./settle.server");
    return settlePending(data.maxCandles);
  });

export interface RejectionRow {
  reason: string;
  n: number;
  settled: number;
  wins: number;
  winRate: number;
}

/**
 * What the filters are throwing away. Every rejected signal now records the
 * direction it would have taken, so each rejection reason gets a real
 * counterfactual win rate: a reason that blocks winners is a filter to loosen.
 */
export const getRejectionReport = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: boolean; rows: RejectionRow[]; error?: string }> => {
    try {
      const db = await admin();
      const { data, error } = await db
        .from("signal_log")
        .select("reason, outcome")
        .eq("verdict", "rejected")
        .order("ts", { ascending: false })
        .limit(20000);
      if (error) return { ok: false, rows: [], error: error.message };

      const map = new Map<string, RejectionRow>();
      for (const r of (data ?? []) as { reason: string | null; outcome: string | null }[]) {
        const reason = r.reason ?? "unknown";
        const row = map.get(reason) ?? { reason, n: 0, settled: 0, wins: 0, winRate: 0 };
        row.n += 1;
        if (r.outcome) {
          row.settled += 1;
          if (r.outcome === "win") row.wins += 1;
        }
        map.set(reason, row);
      }
      const rows = [...map.values()]
        .map((r) => ({ ...r, winRate: r.settled ? (r.wins / r.settled) * 100 : 0 }))
        .sort((a, b) => b.n - a.n);
      return { ok: true, rows };
    } catch (e) {
      return { ok: false, rows: [], error: e instanceof Error ? e.message : "unavailable" };
    }
  },
);


/** Per-pair economics: what a trade risks and what the pair actually returns. */
export interface PairEdgeRow {
  pair: string;
  /** Settled decisions used for the win rate (fired + counterfactuals). */
  n: number;
  wins: number;
  /** Settled trades actually fired on this pair. */
  fired: number;
  firedWins: number;
  /** Average entry price paid, 0-1. */
  avgEntry: number;
  /** Realized dollar P&L booked on this pair. */
  pnl: number;
  trades: number;
}

export interface AccuracyStats {
  ok: boolean;
  total: number;
  wins: number;
  winRate: number;
  /** Settled rejected signals graded as counterfactuals — calibration fuel. */
  counterfactual: number;
  table: CalibrationTable;
  /** Confidence bands split per pair — feeds per-pair calibration. */
  pairTable: PairCalibration;
  pairEdge: PairEdgeRow[];
  byPair: { pair: string; n: number; wins: number }[];
  byMinute: { minute: number; n: number; wins: number }[];
  recent: { ts: string; pair: string; dir: string; conf: number; outcome: string }[];
  error?: string;
}

/**
 * Real, settled accuracy. Headline numbers are the trades the engine actually
 * fired; the calibration table spans fired *and* counterfactual rejections, so
 * the confidence bands fill up in hours instead of weeks and the probability
 * stays honest across the whole score range.
 */
export const getAccuracy = createServerFn({ method: "GET" }).handler(async (): Promise<AccuracyStats> => {
  const empty: AccuracyStats = {
    ok: false,
    total: 0,
    wins: 0,
    winRate: 0,
    counterfactual: 0,
    table: emptyTable(),
    pairTable: {},
    pairEdge: [],
    byPair: [],
    byMinute: [],
    recent: [],
  };
  try {
    const db = await admin();
    const { data, error } = await db
      .from("signal_log")
      .select("ts, pair, dir, conf, seconds_in, outcome, verdict, entry_price")
      .not("outcome", "is", null)
      .order("ts", { ascending: false })
      .limit(20000);
    if (error) return { ...empty, error: error.message };

    const all = (data ?? []) as {
      ts: string;
      pair: string;
      dir: string;
      conf: number | null;
      seconds_in: number | null;
      outcome: string;
      verdict: string;
      entry_price: number | null;
    }[];

    // Realized dollars per pair, from the orders that actually filled.
    const { data: tradeRows } = await db
      .from("trade_log")
      .select("pair, pnl, outcome, entry_price")
      .limit(20000);
    const money = new Map<string, { pnl: number; trades: number }>();
    for (const t of (tradeRows ?? []) as { pair: string; pnl: number | null }[]) {
      // Only settled orders count: failed attempts and unsettled fills carry no
      // realized P&L, and counting them would judge a pair on orders that never
      // had a chance to win or lose.
      if (t.pnl == null) continue;
      const m = money.get(t.pair) ?? { pnl: 0, trades: 0 };
      m.trades += 1;
      m.pnl += t.pnl;
      money.set(t.pair, m);
    }

    // Calibration spans every settled decision; the headline win rate is the
    // trades that were actually taken.
    const rows = all.filter((r) => r.verdict === "fired");
    const table = emptyTable();
    const pairMap = new Map<string, { n: number; wins: number }>();
    const minMap = new Map<number, { n: number; wins: number }>();
    const pairTable: PairCalibration = {};
    const edge = new Map<
      string,
      { n: number; wins: number; fired: number; firedWins: number; entrySum: number; entryN: number }
    >();
    let wins = 0;

    for (const r of all) {
      const won = r.outcome === "win";
      const conf = r.conf ?? 0;
      const band = table.find((b) => conf >= b.lo && conf < b.hi);
      if (band) {
        band.n += 1;
        if (won) band.wins += 1;
      }

      // Same bands, restricted to this pair: the pair's own measured record.
      const pt = (pairTable[r.pair] ??= emptyTable());
      const pband = pt.find((b) => conf >= b.lo && conf < b.hi);
      if (pband) {
        pband.n += 1;
        if (won) pband.wins += 1;
      }

      const e =
        edge.get(r.pair) ?? { n: 0, wins: 0, fired: 0, firedWins: 0, entrySum: 0, entryN: 0 };
      e.n += 1;
      if (won) e.wins += 1;
      if (r.verdict === "fired") {
        e.fired += 1;
        if (won) e.firedWins += 1;
        if (r.entry_price != null && r.entry_price > 0) {
          e.entrySum += r.entry_price;
          e.entryN += 1;
        }
      }
      edge.set(r.pair, e);

      if (r.verdict !== "fired") continue;
      if (won) wins += 1;

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

    const pairEdge: PairEdgeRow[] = [...edge.entries()]
      .map(([pair, e]) => ({
        pair,
        n: e.n,
        wins: e.wins,
        fired: e.fired,
        firedWins: e.firedWins,
        avgEntry: e.entryN ? e.entrySum / e.entryN : 0,
        pnl: money.get(pair)?.pnl ?? 0,
        trades: money.get(pair)?.trades ?? 0,
      }))
      .sort((a, b) => b.n - a.n);


    return {
      ok: true,
      total: rows.length,
      wins,
      winRate: rows.length ? (wins / rows.length) * 100 : 0,
      counterfactual: all.length - rows.length,
      table,
      pairTable,
      pairEdge,
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
