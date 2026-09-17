import {
  calibrateFor,
  evPerDollar,
  MIN_SAMPLES,
  bucketFor,
  returnSigma,
  type CalibrationTable,
  type PairCalibration,
} from "./calibration";
import { candleInfo } from "./candle";
import { ORDER_CUTOFF_BUFFER_SECS } from "./stability";
import {
  CUSHION_PEAK_SIGMA,
  GATE_SECS,
  HIGH_PROB_PRICE,
  HIGH_PROB_THRESHOLD_DISCOUNT,
  LAG_PCT,
  MIN_RESTING_DEPTH,
  PAIRS,
  displayScore,
  SCORE_HALF,
  SCORE_SPAN,
  TICK_LOOKBACK,
} from "./constants";
import { getTuning } from "./tuning";
import type { PairId } from "./constants";
import type { KalshiMarket, LagState, Signal, SpotState } from "./types";

/**
 * Live calibration table, refreshed from settled history. Until enough real
 * outcomes exist this stays empty and confidence is used raw.
 */
let calibration: CalibrationTable | undefined;
/** Per-pair tables so the engine weights the pairs it actually wins on. */
let pairCalibration: PairCalibration | undefined;

export function setCalibration(table: CalibrationTable | undefined, pairTables?: PairCalibration) {
  calibration = table;
  if (pairTables !== undefined) pairCalibration = pairTables;
}

export function getCalibration() {
  return calibration;
}

export function getPairCalibration() {
  return pairCalibration;
}

/**
 * Per-tick return volatility of the recent spot tape, and how far spot sits
 * from the strike measured in expected standard deviations between now and
 * settlement. For a 15-minute binary this matters far more than a raw percent.
 */
export function volStats(spot: SpotState | undefined, strike: number | null, remainSecs: number) {
  if (!spot || spot.ticks.length < 6) return { sigma: 0, sigmaDist: 0 };
  const window = spot.ticks.slice(-TICK_LOOKBACK);
  const sigma = returnSigma(window.map((t) => t.price));
  if (!sigma || strike == null || !spot.price) return { sigma, sigmaDist: 0 };
  const first = window[0]!;
  const last = window[window.length - 1]!;
  const spanMs = Math.max(1, last.ts - first.ts);
  const dt = spanMs / Math.max(1, window.length - 1);
  const stepsLeft = Math.max(1, (remainSecs * 1000) / dt);
  const horizonSigma = sigma * Math.sqrt(stepsLeft);
  if (!horizonSigma) return { sigma, sigmaDist: 0 };
  return { sigma, sigmaDist: (spot.price - strike) / (spot.price * horizonSigma) };
}


function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Rate of change of the last 10 ticks vs the 10 before them. */
export function spotMomentum(spot: SpotState | undefined) {
  if (!spot || spot.ticks.length < 4) return 0;
  const recent = spot.ticks.slice(-10).map((t) => t.price);
  const older = spot.ticks.slice(-20, -10).map((t) => t.price);
  const r = avg(recent) || spot.price;
  const o = avg(older) || r;
  return o ? (r - o) / o : 0;
}

export function midMomentum(spot: SpotState | undefined) {
  if (!spot || spot.ticks.length < 8) return 0;
  const recent = spot.ticks.slice(-30).map((t) => t.price);
  const older = spot.ticks.slice(-60, -30).map((t) => t.price);
  const r = avg(recent) || spot.price;
  const o = avg(older) || r;
  return o ? (r - o) / o : 0;
}

/**
 * Ignore ordinary counter-ticks and veto only a meaningful reversal confirmed
 * by both the short and broader spot windows.
 */
export function isMaterialMomentumReversal(
  dir: "YES" | "NO",
  spotMom: number,
  spotMidMom: number,
) {
  const reversalFloor = LAG_PCT * 0.5;
  const shortAgainst = dir === "YES" ? spotMom <= -reversalFloor : spotMom >= reversalFloor;
  const broadAgainst = dir === "YES" ? spotMidMom < 0 : spotMidMom > 0;
  return shortAgainst && broadAgainst;
}

/** Kalshi yes-mid velocity over the rolling history. */
export function kalshiMomentum(history: number[] | undefined, fallback: number) {
  const h = history ?? [];
  const r = avg(h.slice(-6)) || fallback;
  const o = avg(h.slice(-12, -6)) || r;
  return r - o;
}

export function lagState(
  spot: SpotState | undefined,
  market: KalshiMarket | undefined,
  history: number[] | undefined,
): LagState {
  if (!spot || !market) return "ok";
  const sm = spotMomentum(spot);
  const km = kalshiMomentum(history, market.yesMid);
  const diverg = Math.abs(sm) > LAG_PCT && Math.abs(km) < 0.005;
  const opposite = Math.sign(sm) !== Math.sign(km) && Math.abs(km) > 0.002;
  if (diverg || opposite) return "fire";
  if (Math.abs(sm) > LAG_PCT * 0.5) return "warn";
  return "ok";
}

/**
 * Every measurable input behind one decision, recorded whether the read fired
 * or was rejected. Without these on rejections there is no way to tell whether
 * the score separates winners from losers.
 */
export interface TraceFeatures {
  rawScore?: number | undefined;
  conf?: number | undefined;
  calibrated?: number | undefined;
  entry?: number | undefined;
  ev?: number | undefined;
  skew?: number | undefined;
  spotMom?: number | undefined;
  midMom?: number | undefined;
  kMom?: number | undefined;
  momZ?: number | undefined;
  sigma?: number | undefined;
  sigmaDist?: number | undefined;
  cushionScore?: number | undefined;
  spread?: number | undefined;
  yesMid?: number | undefined;
  depth?: number | undefined;
  minuteIn?: number | undefined;
  spot?: number | undefined;
  strike?: number | null | undefined;
  strikeType?: "floor" | "cap" | null | undefined;
}


export interface SignalTrace {
  pair: PairId;
  verdict: "fired" | "rejected";
  reason: string;
  /**
   * The direction the engine would have taken. Recorded on rejections too, so
   * a rejected signal can be graded as a counterfactual instead of being
   * thrown away.
   */
  dir: "YES" | "NO" | null;
  detail: Record<string, number | string | boolean | null>;
  /** Everything measured up to the point the decision was made. */
  features: TraceFeatures;
}



let debugEnabled =
  typeof import.meta !== "undefined" && Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
let lastTrace: SignalTrace[] = [];

/** Turn the per-pair signal trace (and console output) on or off at runtime. */
export function setSignalDebug(on: boolean) {
  debugEnabled = on;
}

export function isSignalDebug() {
  return debugEnabled;
}

/** Why each pair fired or was rejected on the most recent computeSignals pass. */
export function getSignalTrace(): SignalTrace[] {
  return lastTrace;
}

export function computeSignals(
  spot: Partial<Record<PairId, SpotState>>,
  markets: Partial<Record<PairId, KalshiMarket>>,
  history: Partial<Record<PairId, number[]>>,
  now = Date.now(),
): Signal[] {
  const trace: SignalTrace[] = [];
  /**
   * Features measured so far for the pair currently being scored. Every note
   * snapshots it, so a rejection carries the same numbers a fired signal does.
   */
  let feat: TraceFeatures = {};
  const note = (
    pair: PairId,
    verdict: SignalTrace["verdict"],
    reason: string,
    detail: SignalTrace["detail"] = {},
    dir: SignalTrace["dir"] = null,
  ) => {
    trace.push({ pair, verdict, reason, dir, detail, features: { ...feat } });
  };


  const flush = () => {
    lastTrace = trace;
    if (debugEnabled && trace.length) {
      for (const t of trace) {
        // eslint-disable-next-line no-console
        console.debug(`[signal:${t.pair}] ${t.verdict} — ${t.reason}`, t.detail);
      }
    }
  };

  const T = getTuning();
  const { gateSecs: GATE, closeSecs: CLOSE } = T;
  const c = candleInfo(now);
  if (c.elapsed < GATE || c.elapsed >= CLOSE - ORDER_CUTOFF_BUFFER_SECS) {
    for (const p of PAIRS)
      note(p.id, "rejected", "outside the trade window", {
        elapsed: c.elapsed,
        gate: GATE,
        close: CLOSE - ORDER_CUTOFF_BUFFER_SECS,
      });
    flush();
    return [];
  }

  const out: Signal[] = [];

  // Only readings taken inside this candle may inform momentum or volatility;
  // last candle's regime must not decide this candle's trade.
  const candleStartMs = Math.floor(now / 900_000) * 900_000;

  for (const p of PAIRS) {
    const s = spot[p.id];
    const km = markets[p.id];
    // Fresh feature sheet per pair: whatever is known at the moment a gate
    // stops the read is what gets recorded with that rejection.
    feat = {
      spot: s?.price,
      yesMid: km?.yesMid,
      spread: km?.spread,
      strike: km?.strike ?? null,
      strikeType: km?.strikeType ?? null,
      depth: km ? Math.max(km.yesAskSize ?? 0, km.yesBidSize ?? 0) : undefined,
      minuteIn: Number((((c.elapsed - GATE) / 60)).toFixed(2)),
    };
    const freshTicks = s ? s.ticks.filter((t) => t.ts >= candleStartMs).length : 0;

    if (!s || !km || freshTicks < T.minTicks) {
      note(p.id, "rejected", "not enough live data yet", {
        hasSpot: Boolean(s),
        hasMarket: Boolean(km),
        ticks: freshTicks,
        needed: T.minTicks,
        needTicks: T.minTicks,
      });
      continue;
    }

    // A "floor" contract pays YES when spot finishes at or above the line, a
    // "cap" contract pays YES when it finishes at or below it. So rising spot
    // supports YES on a floor and NO on a cap: every momentum-derived side must
    // be read through this sign, or cap markets get the opposite of the trade.
    const momSign = km?.strikeType === "cap" ? -1 : 1;

    // Direction the engine leans before any gate runs, so even an early
    // rejection can be graded later against what the candle actually did.
    const leanDir: "YES" | "NO" = momSign * spotMomentum(s) >= 0 ? "YES" : "NO";

    // Liquidity / pricing quality gates.
    if (km.spread > T.maxSpread) {
      note(p.id, "rejected", "book too wide", { spread: km.spread, max: T.maxSpread }, leanDir);
      continue;
    }
    if (km.yesMid < T.minYesMid || km.yesMid > T.maxYesMid) {
      note(
        p.id,
        "rejected",
        "mid outside tradable band",
        { yesMid: km.yesMid, min: T.minYesMid, max: T.maxYesMid },
        leanDir,
      );
      continue;
    }
    // Depth belongs with the other cheap book checks, before any scoring: an
    // unfillable book is not an opportunity in the first place.
    if (Math.max(km.yesAskSize ?? 0, km.yesBidSize ?? 0) < MIN_RESTING_DEPTH) {
      note(
        p.id,
        "rejected",
        "nothing resting in the book",
        { yesAskSize: km.yesAskSize ?? 0, yesBidSize: km.yesBidSize ?? 0, min: MIN_RESTING_DEPTH },
        leanDir,
      );
      continue;
    }

    // A read with no strike, or a strike whose rule (above/below) is unknown,
    // cannot be graded or even pointed in a direction. Previously such reads
    // skipped every strike gate and fired blind; they are now refused outright.
    if (km.strike == null || !km.strikeType) {
      note(
        p.id,
        "rejected",
        "contract terms not published yet",
        { strike: km.strike ?? null, strikeType: km.strikeType ?? null },
        leanDir,
      );
      continue;
    }





    const spotMom = spotMomentum(s);
    const spotMidMom = midMomentum(s);
    const ym = km.yesMid;
    const skew = ym - 0.5;
    const kMom = kalshiMomentum(history[p.id], ym);
    const { sigma, sigmaDist } = volStats(s, km.strike, c.remain);
    // Volatility-normalized momentum: a 0.1% move on XRP and on BTC are not
    // the same event, so score the move in units of that pair's own noise.
    const momZ = sigma > 0 ? spotMom / (sigma * 3) : spotMom / LAG_PCT;
    Object.assign(feat, {
      spotMom,
      midMom: spotMidMom,
      skew,
      kMom,
      sigma,
      sigmaDist,
      momZ,
    });



    // The book has to lean one way — unless the read already has real distance
    // from the strike and momentum pointing the same way, which is evidence a
    // coin-flip mid simply hasn't priced yet.
    if (Math.abs(skew) < T.minSkew) {
      const cushionYes = km.strikeType === "floor" ? sigmaDist : -sigmaDist;
      const cushionSide: "YES" | "NO" = cushionYes > 0 ? "YES" : "NO";
      const strongCushion =
        Math.abs(cushionYes) >= T.strongCushion && cushionSide === leanDir;
      if (!strongCushion) {
        note(
          p.id,
          "rejected",
          "book too flat with no other evidence",
          { skew, min: T.minSkew, cushion: Number(cushionYes.toFixed(2)), need: T.strongCushion },
          leanDir,
        );
        continue;
      }
    }


    const lagDetected = Math.abs(spotMom) > LAG_PCT && Math.abs(kMom) < 0.008;
    const lagDir: "YES" | "NO" = momSign * spotMom > 0 ? "YES" : "NO";

    const liq = km.spread < 0.02 ? 1.05 : km.spread < 0.04 ? 0.9 : km.spread < 0.06 ? 0.75 : 0.55;

    const minuteIn = (c.elapsed - GATE) / 60;
    const tFac = minuteIn < 2 ? 1.0 : minuteIn < 3 ? 0.88 : 0.72;

    // Expressed as a YES/NO lean already, so it can be compared with the book.
    const sDir = Math.sign(momSign * (spotMom || spotMidMom));
    const skDir = Math.sign(skew);
    const kDir = Math.sign(kMom);
    const agreement =
      sDir === skDir && skDir === kDir ? 1.35 : sDir === skDir || skDir === kDir ? 1.05 : 0.6;

    const lagBoost = lagDetected ? 1.3 : 1.0;
    // Cushion is a BAND, not "more is better". Below the floor it is a coin
    // flip; far beyond the band the outcome is a near-certainty the book has
    // already priced, so the score decays instead of pinning at the top.
    const absCushion = Math.abs(sigmaDist);
    const cushionScore =
      absCushion <= CUSHION_PEAK_SIGMA
        ? absCushion / CUSHION_PEAK_SIGMA
        : Math.max(
            0,
            1 -
              ((absCushion - CUSHION_PEAK_SIGMA) /
                Math.max(0.01, T.maxSigmaDist - CUSHION_PEAK_SIGMA)) *
                0.7,
          );
    const raw =
      Math.abs(skew) * 0.4 +
      Math.min(Math.abs(momZ), 2) * 0.2 +
      (Math.abs(kMom) / 0.008) * 0.15 +
      cushionScore * 0.25;
    const strength = raw * agreement * liq * tFac * lagBoost;
    // Soft-saturating score: with the old hard cap 210 of 248 live reads all
    // read 99, so the threshold could not discriminate at all. This curve keeps
    // spreading as evidence grows and never reaches the ceiling.
    const rawScore = 50 + SCORE_SPAN * (strength / (strength + SCORE_HALF));
    // Bucket on the raw curve, then judge and DISPLAY the same compressed
    // number, so the dial can never be compared against a value the panel
    // does not show.
    const calibrationSamples = bucketFor(rawScore, calibration)?.n ?? 0;
    const calibrationReady = calibrationSamples >= MIN_SAMPLES;
    const conf = displayScore(rawScore, calibrationReady);
    Object.assign(feat, { cushionScore, rawScore, conf });



    // Direction is resolved before the gates so every rejection below records
    // the trade it would have been.
    let dir: "YES" | "NO";
    if (lagDetected && Math.abs(spotMom) > LAG_PCT * 1.5) dir = lagDir;
    else if (sDir === skDir) dir = sDir > 0 ? "YES" : "NO";
    else if (Math.abs(skew) > (Math.abs(spotMom) / LAG_PCT) * 0.01) dir = skew > 0 ? "YES" : "NO";
    else dir = momSign * spotMom > 0 ? "YES" : "NO";

    // High-probability legs already carry the book's agreement, so demanding
    // the full dial double-counts the same evidence — discount the threshold.
    const priceEstimate = Math.min(
      0.99,
      Math.max(0.01, dir === "YES" ? km.yesAsk || ym + km.spread / 2 : km.noAsk || 1 - ym + km.spread / 2),
    );
    const effectiveThreshold =
      priceEstimate >= HIGH_PROB_PRICE
        ? Math.max(0, T.threshold - HIGH_PROB_THRESHOLD_DISCOUNT)
        : T.threshold;

    if (conf < effectiveThreshold) {
      note(
        p.id,
        "rejected",
        `confidence below threshold — missed by ${(effectiveThreshold - conf).toFixed(1)}`,
        {
          conf: Number(conf.toFixed(1)),
          threshold: effectiveThreshold,
          fullThreshold: T.threshold,
          missedBy: Number((effectiveThreshold - conf).toFixed(1)),
          agreement,
          liq,
          sigmaDist: Number(sigmaDist.toFixed(2)),
        },
        dir,
      );
      continue;
    }


    // Cushion measured in the direction actually being bought: positive means
    // spot sits on the winning side of the strike for this leg. For a "cap"
    // contract YES wins below the strike, so the raw distance flips sign.
    const yesCushion = km.strikeType === "floor" ? sigmaDist : -sigmaDist;
    let dirCushion = dir === "YES" ? yesCushion : -yesCushion;

    // Wrong side of the strike used to kill the read outright, even though 81%
    // of those graded later won. Flip to the side spot actually supports and
    // keep running every remaining protection against the new direction.
    if (dirCushion <= 0) {
      const flipped: "YES" | "NO" = dir === "YES" ? "NO" : "YES";
      const flippedCushion = flipped === "YES" ? yesCushion : -yesCushion;
      if (flippedCushion > 0) {
        dir = flipped;
        dirCushion = flippedCushion;
      } else {
        note(
          p.id,
          "rejected",
          "neither side of the strike has a cushion",
          { spot: s.price, strike: km.strike, dirCushion: Number(dirCushion.toFixed(2)) },
          dir,
        );
        continue;
      }
    }

    // A tiny counter-tick is noise. Only block a material reversal when both
    // the short and broader spot windows confirm it against the chosen side.
    const reversalFloor = LAG_PCT * 0.5;
    // Momentum is re-expressed in the direction that helps this contract type,
    // so a cap market is not judged as if YES meant "price up".
    if (isMaterialMomentumReversal(dir, momSign * spotMom, momSign * spotMidMom)) {
      note(
        p.id,
        "rejected",
        "confirmed spot reversal fights the direction",
        { dir, spotMom, midMom: spotMidMom, reversalFloor },
        dir,
      );
      continue;
    }

    // The book must not be pricing against us either.
    if ((dir === "YES" && skew < 0) || (dir === "NO" && skew > 0)) {
      note(p.id, "rejected", "book prices against the direction", { dir, skew }, dir);
      continue;
    }

    // No measurable volatility means no honest cushion measurement either.
    if (!(sigma > 0)) {
      note(p.id, "rejected", "not enough movement to measure risk yet", { sigma }, dir);
      continue;
    }

    // Cushion gate: too close to the strike relative to how much this pair can
    // still move is a coin flip no matter how confident the score looks.
    if (dirCushion < T.minSigmaDist) {
      note(
        p.id,
        "rejected",
        "spot too close to the strike to be safe",
        { sigmaDist: Number(dirCushion.toFixed(2)), min: T.minSigmaDist },
        dir,
      );
      continue;
    }

    // Upper edge of the cushion band: a contract this far in the money is a
    // near-certainty the book has already paid for, so there is no room left.
    if (dirCushion > T.maxSigmaDist) {
      note(
        p.id,
        "rejected",
        "already too deep in the money to be worth its price",
        { sigmaDist: Number(dirCushion.toFixed(2)), max: T.maxSigmaDist },
        dir,
      );
      continue;
    }

    // Price the trade honestly: calibrated probability vs. what we actually pay.
    const entry = Math.min(
      0.99,
      Math.max(0.01, (dir === "YES" ? km.yesAsk || ym + km.spread / 2 : km.noAsk || 1 - ym + km.spread / 2)),
    );
    const calibrated = calibrateFor(p.id, rawScore, calibration, pairCalibration);

    const ev = evPerDollar(calibrated, entry);
    Object.assign(feat, { entry, calibrated, ev });

    // The leg we would actually buy must have something resting on it.
    const legDepth = dir === "YES" ? (km.yesAskSize ?? 0) : (km.yesBidSize ?? 0);
    if (legDepth < MIN_RESTING_DEPTH) {
      note(
        p.id,
        "rejected",
        "no depth on the side we would buy",
        { legDepth, min: MIN_RESTING_DEPTH },
        dir,
      );
      continue;
    }

    // Price ceiling: absolute once confidence is proven, tighter until then.
    const ceiling = calibrationReady ? T.maxEntry : Math.min(T.maxEntry, T.maxEntryUnproven);
    if (entry > ceiling + 1e-9) {
      note(
        p.id,
        "rejected",
        calibrationReady
          ? "leg costs more than the absolute ceiling"
          : "leg too expensive for an unproven score",
        {
          entry: Number(entry.toFixed(2)),
          max: ceiling,
          limit: calibrationReady ? "absolute" : "unproven",
        },
        dir,
      );
      continue;
    }

    // Above the comfort price the leg must earn it on value, using the
    // calibrated probability when proven and the score itself before that.
    if (entry > T.entryValueTestPrice) {
      const probEstimate = calibrationReady ? calibrated : conf / 100;
      const valueAtPrice = evPerDollar(probEstimate, entry);
      if (valueAtPrice < T.evMargin) {
        note(
          p.id,
          "rejected",
          "price this high is not justified by the value",
          {
            entry: Number(entry.toFixed(2)),
            prob: Number(probEstimate.toFixed(3)),
            value: Number(valueAtPrice.toFixed(3)),
            need: T.evMargin,
          },
          dir,
        );
        continue;
      }
    }


    if (calibrationReady && ev < T.evMargin) {
      note(
        p.id,
        "rejected",
        "not enough value at this price",
        {
          entry: Number(entry.toFixed(2)),
          calibrated: Number(calibrated.toFixed(3)),
          ev: Number(ev.toFixed(3)),
          need: T.evMargin,
        },
        dir,
      );
      continue;
    }


    const lagNote = lagDetected
      ? ` BRTI LAG — spot ${spotMom > 0 ? "accelerating up" : "dropping"} (${(spotMom * 100).toFixed(3)}%) while the Kalshi book hasn't moved.`
      : "";

    // Label the price of the LEG we would buy, not the YES mid. A "NO at 11¢"
    // label on a 89¢ NO made cheap-looking trades look like free money.
    note(
      p.id,
      "fired",
      `${dir} costs ${(entry * 100).toFixed(0)}¢`,
      {
        conf: Number(conf.toFixed(1)),
        calibrated: Number(calibrated.toFixed(3)),
        ev: Number(ev.toFixed(3)),
        skew,
        spotMom,
        kMom,
        sigmaDist: Number(dirCushion.toFixed(2)),
        lagDetected,
      },
      dir,
    );


    out.push({
      id: `${p.id}-${Math.floor(c.elapsed / 5)}-${dir}`,
      pair: p.id,
      dir,
      // Already compressed into the band its evidence earns, not clamped.
      conf,

      yesMid: ym,
      spread: km.spread,
      spotMom,
      kMom,
      lagDetected,
      calibrated,
        calibrationReady,
      calibrationSamples,

      entry,
      ev,
      sigmaDist: dirCushion,
      skew,
      reason: `${calibrationReady ? `Betting ${dir} at ${(entry * 100).toFixed(0)}¢ · conservative edge ${(ev * 100).toFixed(0)}% per $` : `Shadow ${dir} at ${(entry * 100).toFixed(0)}¢ · score only, probability unproven`} · cushion +${dirCushion.toFixed(2)}σ on the ${dir} side · skew ${(Math.abs(skew) * 100).toFixed(1)}% ${dir} · last 10s drift ${spotMom >= 0 ? "+" : ""}${(spotMom * 100).toFixed(3)}%.${(dir === "YES" ? spotMom < 0 : spotMom > 0) ? ` Drift is running against this side — a small wiggle rarely covers the remaining distance in the time left.` : ""}${lagNote}`,
      elapsed: c.elapsed,
      remain: c.remain,
    });
  }

  flush();
  // Rank by expected value per dollar risked, not raw confidence: paying 80¢
  // for an 88% shot is worse than paying 45¢ for the same read.
  return out.sort((a, b) => b.ev - a.ev || b.conf - a.conf);
}

