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
