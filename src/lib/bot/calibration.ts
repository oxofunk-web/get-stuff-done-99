/**
 * Confidence calibration.
 *
 * The engine's `conf` score is a hand-built number, not a probability. Once we
 * have enough settled history we map each confidence band onto the win rate it
 * actually achieved, so the EV gate reasons about a real probability instead of
 * a vibe. With little or no history it falls back to conf/100 unchanged.
 */

export interface CalibrationBucket {
  lo: number;
  hi: number;
  n: number;
  wins: number;
}

export type CalibrationTable = CalibrationBucket[];

/** Confidence bands used everywhere (accuracy panel + calibration). */
export const BANDS: [number, number][] = [
  [50, 80],
  [80, 85],
  [85, 90],
  [90, 95],
  [95, 101],
];

/** Below this many settled samples a band keeps the raw score. */
export const MIN_SAMPLES = 20;

/** Pseudo-count pulling a thin bucket back toward the raw score. */
const PRIOR = 5;

export function bandLabel(lo: number, hi: number) {
  return hi >= 101 ? `${lo}%+` : `${lo}–${hi}%`;
}

export function emptyTable(): CalibrationTable {
  return BANDS.map(([lo, hi]) => ({ lo, hi, n: 0, wins: 0 }));
}

export function bucketFor(conf: number, table: CalibrationTable | undefined) {
  if (!table) return undefined;
  return table.find((b) => conf >= b.lo && conf < b.hi);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Raw confidence (0-100) → calibrated probability (0-1). */
export function calibrate(conf: number, table?: CalibrationTable): number {
  const raw = clamp(conf / 100, 0.01, 0.99);
  const b = bucketFor(conf, table);
  if (!b || b.n < MIN_SAMPLES) return raw;
  const blended = (b.wins + raw * PRIOR) / (b.n + PRIOR);
  return clamp(blended, 0.01, 0.99);
}

/** Per-pair calibration tables, keyed by pair id. */
export type PairCalibration = Record<string, CalibrationTable>;

/**
 * Shrinkage weight for a pair's own record. `PAIR_FULL_TRUST` settled samples
 * inside the band is where the pair's own win rate is trusted outright; below
 * that it is pulled toward the global curve so 2-3 lucky trades cannot move the
 * probability.
 */
export const PAIR_FULL_TRUST = 40;

/**
 * Calibrated probability that weights the pair's *own* settled record.
 *
 * global   = the all-pairs band calibration (today's behaviour)
 * pairRate = the same band restricted to this pair
 * result   = global blended toward pairRate, weighted by how much pair history
 *            exists. No pair history → identical to `calibrate`.
 */
export function calibrateFor(
  pair: string,
  conf: number,
  table?: CalibrationTable,
  pairTables?: PairCalibration,
): number {
  const global = calibrate(conf, table);
  const pb = bucketFor(conf, pairTables?.[pair]);
  if (!pb || pb.n <= 0) return global;
  const pairRate = (pb.wins + global * PRIOR) / (pb.n + PRIOR);
  const w = clamp(pb.n / PAIR_FULL_TRUST, 0, 1);
  return clamp(global * (1 - w) + pairRate * w, 0.01, 0.99);
}

/** Expected value per dollar risked at a given fill price. */
export function evPerDollar(prob: number, price: number) {
  const p = clamp(prob, 0.01, 0.99);
  const c = clamp(price, 0.01, 0.99);
  return (p * (1 - c) - (1 - p) * c) / c;
}

/** Sample standard deviation of tick-to-tick returns. */
export function returnSigma(prices: number[]): number {
  if (prices.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < prices.length; i += 1) {
    const prev = prices[i - 1]!;
    if (prev) rets.push((prices[i]! - prev) / prev);
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr);
}
