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
  MAX_SIGMA_DIST,
  MAX_ENTRY_PRICE,
  MAX_ENTRY_PRICE_UNPROVEN,
  ENTRY_VALUE_TEST_PRICE,
  STRONG_CUSHION_SIGMA,
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
  /** Upper edge of the cushion band — past this the contract is fully priced. */
  maxSigmaDist: number;
  /** Absolute highest price per contract the engine will pay for the leg. */
  maxEntry: number;
  /** Tighter ceiling used while confidence is still unproven. */
  maxEntryUnproven: number;
  /** Price above which the leg must also clear the value margin. */
  entryValueTestPrice: number;
  /** Cushion that can stand in for a leaning book. */
  strongCushion: number;
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
  maxSigmaDist: MAX_SIGMA_DIST,
  maxEntry: MAX_ENTRY_PRICE,
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
