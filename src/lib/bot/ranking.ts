/**
 * Trade selection.
 *
 * The gates decide which signals are *allowed*; this decides which of the
 * allowed ones actually get the money. A pair's own settled record (win rate
 * versus the breakeven its entry prices demand) is blended into the signal's
 * expected value, so with two candidates the bot buys the pair it genuinely
 * wins on instead of whichever happened to be listed first.
 */

import type { PairEdgeRow } from "./telemetry.functions";
import type { Signal } from "./types";

/** Samples at which a pair's measured edge is trusted at full weight. */
export const EDGE_FULL_TRUST = 20;
/** How much a fully-trusted edge can move the ranking score, per dollar. */
const EDGE_WEIGHT = 0.5;

export type PairEdgeMap = Record<string, PairEdgeRow>;

let edgeMap: PairEdgeMap = {};

export function setPairEdge(rows: PairEdgeRow[] | undefined) {
  const next: PairEdgeMap = {};
  for (const r of rows ?? []) next[r.pair] = r;
  edgeMap = next;
}

export function getPairEdge() {
  return edgeMap;
}

/**
 * Measured edge for a pair, in probability points (0-1), already shrunk toward
 * zero when the sample is thin. Positive = wins more often than the prices it
 * paid require.
 */
export function pairEdgeScore(pair: string, map: PairEdgeMap = edgeMap): number {
  const e = map[pair];
  if (!e || !e.fired || e.avgEntry <= 0) return 0;
  const actual = e.firedWins / e.fired;
  const breakeven = e.avgEntry;
  const weight = Math.min(1, e.fired / EDGE_FULL_TRUST);
  return (actual - breakeven) * weight;
}

/** Ranking score: expected value per dollar, tilted by the pair's real record. */
export function rankScore(s: Signal, map: PairEdgeMap = edgeMap): number {
  return s.ev + pairEdgeScore(s.pair, map) * EDGE_WEIGHT;
}

/** Best-first ordering of tradable signals. */
export function rankSignals(signals: Signal[], map: PairEdgeMap = edgeMap): Signal[] {
  return [...signals].sort((a, b) => rankScore(b, map) - rankScore(a, map) || b.conf - a.conf);
}

/**
 * Hard veto: once a pair has enough settled trades to judge and its realized
 * P&L is negative, the bot stops buying it. Graded near-misses keep recording,
 * so the pair re-qualifies on its own once the record recovers.
 */
export const VETO_MIN_TRADES = 5;

export function pairVetoed(pair: string, map: PairEdgeMap = edgeMap): boolean {
  const e = map[pair];
  if (!e) return false;
  return e.trades >= VETO_MIN_TRADES && e.pnl < 0;
}

/** Signals with vetoed pairs removed — apply before ranking for trade selection. */
export function dropVetoed(signals: Signal[], map: PairEdgeMap = edgeMap): Signal[] {
  return signals.filter((s) => !pairVetoed(s.pair, map));
}
