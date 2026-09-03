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

/**
 * Ranking score, per dollar risked:
 *   EV  +  measured edge (sample-weighted, weighted above raw EV)
 *       -  penalty for expensive entries
 *
 * The edge term rewards pairs whose settled trades actually win more often than
 * the prices they paid demand. The penalty pushes down pairs whose typical fill
 * sits near the top of the book, since those need a punishing win rate just to
 * break even.
 */
export function rankScore(s: Signal, map: PairEdgeMap = edgeMap): number {
  const e = map[s.pair];
  const fired = e?.fired ?? 0;
  const weight = Math.min(1, fired / EDGE_FULL_TRUST);
  // Proven pairs get their measured record weighted above raw EV.
  const edgeTerm = pairEdgeScore(s.pair, map) * (EDGE_WEIGHT + PROVEN_EDGE_BONUS * weight);
  const breakeven = e && e.avgEntry > 0 ? e.avgEntry : s.entry;
  const penalty = BREAKEVEN_PENALTY * Math.max(0, breakeven - BREAKEVEN_FREE);
  return s.ev + edgeTerm - penalty;
}

/** Extra edge weight once a pair has a full-trust sample. */
const PROVEN_EDGE_BONUS = 0.7;
/** Entry price above which the breakeven penalty starts biting. */
const BREAKEVEN_FREE = 0.5;
/** How hard an expensive average entry is punished. */
const BREAKEVEN_PENALTY = 0.3;

/** Best-first ordering of tradable signals. */
export function rankSignals(signals: Signal[], map: PairEdgeMap = edgeMap): Signal[] {
  return [...signals].sort((a, b) => rankScore(b, map) - rankScore(a, map) || b.conf - a.conf);
}

/**
 * Cooldown instead of a permanent ban: once a pair has enough settled trades to
 * judge and its realized P&L is negative, the bot stops buying it — but every
 * COOLDOWN_CANDLES candles it gets one probe candle so the pair can prove
 * itself again instead of being frozen out forever.
 *
 * Pairs listed in MANUAL_RESUME were un-paused by hand: they stay tradable
 * until their P&L drops below the baseline recorded at resume time.
 */
export const VETO_MIN_TRADES = 5;
export const COOLDOWN_CANDLES = 4;
export const CANDLE_MS = 15 * 60 * 1000;

/** Pair -> P&L baseline at manual resume. Re-pauses only on a new loss. */
/* Cleared on the 2026-09-03 full reset: history was wiped, so no pair is paused. */
export const MANUAL_RESUME: Record<string, number> = {};

/** Deterministic candle index, identical on client and server. */
export function candleIndex(now: number = Date.now()): number {
  return Math.floor(now / CANDLE_MS);
}

export function pairVetoed(pair: string, map: PairEdgeMap = edgeMap, now: number = Date.now()): boolean {
  const e = map[pair];
  if (!e) return false;
  if (!(e.trades >= VETO_MIN_TRADES && e.pnl < 0)) return false;
  const base = MANUAL_RESUME[pair];
  if (base != null && e.pnl >= base) return false;
  // Probe candle: let the pair trade once every cooldown cycle.
  if (candleIndex(now) % COOLDOWN_CANDLES === 0) return false;
  return true;
}

/** Candles left before a paused pair gets its next probe candle. */
export function pauseCandlesLeft(now: number = Date.now()): number {
  const rem = COOLDOWN_CANDLES - (candleIndex(now) % COOLDOWN_CANDLES);
  return rem === COOLDOWN_CANDLES ? 0 : rem;
}

/** Signals with paused pairs removed — apply before ranking for trade selection. */
export function dropVetoed(signals: Signal[], map: PairEdgeMap = edgeMap, now: number = Date.now()): Signal[] {
  return signals.filter((s) => !pairVetoed(s.pair, map, now));
}

