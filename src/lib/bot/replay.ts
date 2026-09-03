import { PAIRS, type PairId } from "./constants";
import type { BacktestFrame } from "./backtest";
import type { KalshiMarket } from "./types";

/**
 * Replay of *recorded* market state. Rows come straight out of the
 * `market_snapshots` tape written by the live engine, so the books and the BRTI
 * spot are the real prices the bot saw — no synthetic pricing model anywhere in
 * the loop.
 */
export interface SnapshotRow {
  ts: string;
  candle_id: number | string;
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

const VALID = new Set<string>(PAIRS.map((p) => p.id));

function clampPrice(v: number) {
  return Math.min(0.99, Math.max(0.01, v));
}

/**
 * Rebuild a `KalshiMarket` from a recorded row. The tape stores the YES side
 * (that is what Kalshi quotes); the NO side is its exact complement, which is
 * how the live client derives it too.
 */
function marketFromRow(row: SnapshotRow): KalshiMarket | null {
  const yesBid = row.yes_bid;
  const yesAsk = row.yes_ask;
  if (yesBid == null || yesAsk == null) return null;
  const bid = clampPrice(yesBid);
  const ask = clampPrice(yesAsk);
  const mid = row.yes_mid ?? (bid + ask) / 2;
  return {
    // The tape records quotes, not resting size — treat replay books as deep.
    yesAskSize: 10000,
    yesBidSize: 10000,
    pair: row.pair as PairId,
    ticker: row.ticker ?? `${row.pair}-REPLAY`,
    strike: row.strike,
    yesBid: bid,
    yesAsk: ask,
    noBid: clampPrice(1 - ask),
    noAsk: clampPrice(1 - bid),
    yesMid: mid,
    spread: row.spread ?? Math.max(0, ask - bid),
    vol: row.vol ?? 0,
    closeTime: null,
  };
}

export interface ReplayStats {
  frames: number;
  rows: number;
  withBooks: number;
  pairs: PairId[];
  fromTs: number | null;
  toTs: number | null;
}

/**
 * Group recorded rows into per-instant frames the backtest can replay.
 * Rows written in the same engine tick share `candle_id` + `seconds_in`, so
 * that pair is the frame key.
 */
export function framesFromSnapshots(rows: SnapshotRow[]): {
  frames: BacktestFrame[];
  stats: ReplayStats;
} {
  const buckets = new Map<string, BacktestFrame>();
  const pairs = new Set<PairId>();
  let withBooks = 0;

  for (const row of rows) {
    if (!VALID.has(row.pair)) continue;
    const pair = row.pair as PairId;
    const key = `${row.candle_id}:${row.seconds_in}`;
    const ts = Date.parse(row.ts);
    let frame = buckets.get(key);
    if (!frame) {
      frame = { ts: Number.isFinite(ts) ? ts : 0, spot: {}, markets: {} };
      buckets.set(key, frame);
    }
    if (!Number.isFinite(row.spot)) continue;
    pairs.add(pair);
    frame.spot[pair] = { price: row.spot };
    const market = marketFromRow(row);
    if (market) {
      frame.markets[pair] = market;
      withBooks += 1;
    }
  }

  const frames = [...buckets.values()].filter((f) => f.ts > 0).sort((a, b) => a.ts - b.ts);

  return {
    frames,
    stats: {
      frames: frames.length,
      rows: rows.length,
      withBooks,
      pairs: [...pairs],
      fromTs: frames.length ? frames[0]!.ts : null,
      toTs: frames.length ? frames[frames.length - 1]!.ts : null,
    },
  };
}

export function formatReplayStats(s: ReplayStats) {
  const span =
    s.fromTs && s.toTs ? `${new Date(s.fromTs).toISOString()} → ${new Date(s.toTs).toISOString()}` : "no data";
  return `rows=${s.rows} frames=${s.frames} books=${s.withBooks} pairs=${s.pairs.join(",") || "-"} span=${span}`;
}
