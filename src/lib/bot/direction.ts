import { returnSigma } from "./calibration";
import { candleInfo } from "./candle";
import type { PairId } from "./constants";
import type { SpotState } from "./types";

export interface DirectionCall {
  pair: PairId;
  /** Where the 15-minute candle is heading versus where it opened. */
  dir: "UP" | "DOWN";
  /** Chance the candle closes on that side, 0-100. */
  prob: number;
  open: number;
  now: number;
  delta: number;
  deltaPct: number;
  /** Short-term drift of the last ~10 readings, as a fraction. */
  drift: number;
  remain: number;
  elapsed: number;
  /** False while there is not yet enough live price history to call it. */
  ready: boolean;
  note: string;
  /** The model's predicted close for this candle. Null when not ready. */
  predictedClose: number | null;
  /** One standard deviation around the predicted close. Null when not ready. */
  closeSigma: number | null;
  /** Normal-model internals, so callers can price arbitrary strikes. Null when not ready. */
  model: ProbModel | null;
}

/** The normal model directionCall fits: P(close > K) = Phi((driftedPrice - K) / priceHorizon). */
export interface ProbModel {
  driftedPrice: number;
  priceHorizon: number;
}

/** Chance the candle closes above an arbitrary strike, under the fitted model. */
export function probCloseAbove(strike: number, model: ProbModel): number {
  if (!(model.priceHorizon > 0) || !Number.isFinite(strike)) return 0.5;
  return normCdf((model.driftedPrice - strike) / model.priceHorizon);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf approximation). */
function normCdf(z: number) {
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + s * erf);
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function drift(ticks: { price: number }[]) {
  if (ticks.length < 4) return 0;
  const recent = avg(ticks.slice(-10).map((t) => t.price));
  const older = avg(ticks.slice(-20, -10).map((t) => t.price)) || recent;
  return older ? (recent - older) / older : 0;
}

/**
 * Will this coin's 15-minute candle finish above or below where it opened?
 *
 * The call is the distance already travelled from the candle open, judged
 * against how far the coin can still move in the time left. A big move early
 * in a quiet candle is a strong call; the same move with 13 minutes left is not.
 */
export function directionCall(
  pair: PairId,
  spot: SpotState | undefined,
  candleOpen: number | undefined,
  now = Date.now(),
): DirectionCall {
  const c = candleInfo(now);
  const price = spot?.price ?? 0;
  const open = candleOpen ?? spot?.ticks[0]?.price ?? price;
  const delta = price && open ? price - open : 0;
  const deltaPct = open ? (delta / open) * 100 : 0;
  const d = drift(spot?.ticks ?? []);

  const base: DirectionCall = {
    pair,
    dir: delta >= 0 ? "UP" : "DOWN",
    prob: 50,
    open,
    now: price,
    delta,
    deltaPct,
    drift: d,
    remain: c.remain,
    elapsed: c.elapsed,
    ready: false,
    note: "Gathering live prices for this candle…",
    predictedClose: null,
    closeSigma: null,
    model: null,
  };

  const ticks = spot?.ticks ?? [];
  if (!price || !open || ticks.length < 8) return base;

  const window = ticks.slice(-60);
  const sigma = returnSigma(window.map((t) => t.price));
  if (!sigma) return base;

  const first = window[0]!;
  const last = window[window.length - 1]!;
  const dt = Math.max(250, (last.ts - first.ts) / Math.max(1, window.length - 1));
  const stepsLeft = Math.max(1, (c.remain * 1000) / dt);
  const horizon = sigma * Math.sqrt(stepsLeft);
  if (!horizon) return base;

  // Expected close leans slightly with the current drift over the time left.
  const driftedPrice = price * (1 + d * (c.remain / 600));
  const z = (driftedPrice - open) / (price * horizon);
  const pUp = normCdf(z);
  // Direction is strictly which side of the open price is on; drift only
  // adjusts the confidence, it can never invert the call.
  const dir: "UP" | "DOWN" = delta >= 0 ? "UP" : "DOWN";
  // Never show a certainty: a model reading can be strong, never guaranteed.
  const prob = Math.max(0, Math.min(97, (dir === "UP" ? pUp : 1 - pUp) * 100));

  const moved = Math.abs(deltaPct).toFixed(deltaPct === 0 ? 0 : 3);
  const driftWord = d > 0 ? "drifting up" : d < 0 ? "drifting down" : "flat";
  const against = (dir === "UP" && d < 0) || (dir === "DOWN" && d > 0);
  const note =
    `${moved}% ${delta >= 0 ? "above" : "below"} the open, ${driftWord}` +
    (against ? " against the call — recent noise, not the read." : ".") +
    ` Room left to move: ${(horizon * 100).toFixed(2)}%.`;

  return {
    ...base,
    dir,
    prob,
    ready: true,
    note,
    predictedClose: driftedPrice,
    closeSigma: price * horizon,
    model: { driftedPrice, priceHorizon: price * horizon },
  };
}
