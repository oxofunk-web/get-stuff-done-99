import {
  CLOSE_SECS,
  GATE_SECS,
  MAX_SPREAD,
  MAX_YES_MID,
  MIN_SKEW,
  MIN_TICKS,
  MIN_YES_MID,
  THRESHOLD,
  EV_MARGIN,
  MIN_SIGMA_DIST,
} from "./constants";

/**
 * Live-tunable copies of the signal filters. Defaults mirror constants.ts so
 * runtime behaviour is unchanged; the offline tuner sweeps these to find the
 * combination with the best real-data ROI.
 */
export interface Tuning {
  threshold: number;
  maxSpread: number;
  minYesMid: number;
  maxYesMid: number;
  minSkew: number;
  minTicks: number;
  gateSecs: number;
  closeSecs: number;
  /** Minimum expected value per dollar risked before a signal may fire. */
  evMargin: number;
  /** Minimum cushion between spot and strike, in standard deviations. */
  minSigmaDist: number;
}

const defaults: Tuning = {
  threshold: THRESHOLD,
  maxSpread: MAX_SPREAD,
  minYesMid: MIN_YES_MID,
  maxYesMid: MAX_YES_MID,
  minSkew: MIN_SKEW,
  minTicks: MIN_TICKS,
  gateSecs: GATE_SECS,
  closeSecs: CLOSE_SECS,
  evMargin: EV_MARGIN,
  minSigmaDist: MIN_SIGMA_DIST,
};

let current: Tuning = { ...defaults };

export function getTuning(): Tuning {
  return current;
}

export function setTuning(patch: Partial<Tuning>) {
  current = { ...current, ...patch };
}

export function resetTuning() {
  current = { ...defaults };
}
