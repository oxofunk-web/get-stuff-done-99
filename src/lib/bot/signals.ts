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
import { GATE_SECS, LAG_PCT, PAIRS } from "./constants";
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
  const window = spot.ticks.slice(-60);
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
  const note = (
    pair: PairId,
    verdict: SignalTrace["verdict"],
    reason: string,
    detail: SignalTrace["detail"] = {},
    dir: SignalTrace["dir"] = null,
  ) => {
    trace.push({ pair, verdict, reason, dir, detail });
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

  for (const p of PAIRS) {
    const s = spot[p.id];
    const km = markets[p.id];
    if (!s || !km || s.ticks.length < T.minTicks) {
      note(p.id, "rejected", "not enough live data yet", {
        hasSpot: Boolean(s),
        hasMarket: Boolean(km),
        ticks: s?.ticks.length ?? 0,
        needTicks: T.minTicks,
      });
      continue;
    }

    // Direction the engine leans before any gate runs, so even an early
    // rejection can be graded later against what the candle actually did.
    const leanDir: "YES" | "NO" = spotMomentum(s) >= 0 ? "YES" : "NO";

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

    const spotMom = spotMomentum(s);
    const spotMidMom = midMomentum(s);
    const ym = km.yesMid;
    const skew = ym - 0.5;
    const kMom = kalshiMomentum(history[p.id], ym);
    const { sigma, sigmaDist } = volStats(s, km.strike, c.remain);
    // Volatility-normalized momentum: a 0.1% move on XRP and on BTC are not
    // the same event, so score the move in units of that pair's own noise.
    const momZ = sigma > 0 ? spotMom / (sigma * 3) : spotMom / LAG_PCT;

    // The book has to actually lean one way — coin-flip mids are noise.
    if (Math.abs(skew) < T.minSkew) {
      note(p.id, "rejected", "book too flat", { skew, min: T.minSkew }, leanDir);
      continue;
    }


    const lagDetected = Math.abs(spotMom) > LAG_PCT && Math.abs(kMom) < 0.008;
    const lagDir: "YES" | "NO" = spotMom > 0 ? "YES" : "NO";

    const liq = km.spread < 0.02 ? 1.05 : km.spread < 0.04 ? 0.9 : km.spread < 0.06 ? 0.75 : 0.55;

    const minuteIn = (c.elapsed - GATE) / 60;
    const tFac = minuteIn < 2 ? 1.0 : minuteIn < 3 ? 0.88 : 0.72;

    const sDir = Math.sign(spotMom || spotMidMom);
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
    const conf = 50 + SCORE_SPAN * (strength / (strength + SCORE_HALF));


    // Direction is resolved before the gates so every rejection below records
    // the trade it would have been.
    let dir: "YES" | "NO";
    if (lagDetected && Math.abs(spotMom) > LAG_PCT * 1.5) dir = lagDir;
    else if (sDir === skDir) dir = sDir > 0 ? "YES" : "NO";
    else if (Math.abs(skew) > (Math.abs(spotMom) / LAG_PCT) * 0.01) dir = skew > 0 ? "YES" : "NO";
    else dir = spotMom > 0 ? "YES" : "NO";

    if (conf < T.threshold) {
      note(
        p.id,
        "rejected",
        "confidence below threshold",
        {
          conf: Number(conf.toFixed(1)),
          threshold: T.threshold,
          agreement,
          liq,
          sigmaDist: Number(sigmaDist.toFixed(2)),
        },
        dir,
      );
      continue;
    }

    // Spot momentum must not fight the chosen direction.
    const momDir = Math.sign(spotMom || spotMidMom);
    if (momDir !== 0 && ((dir === "YES" && momDir < 0) || (dir === "NO" && momDir > 0))) {
      note(p.id, "rejected", "spot momentum fights the direction", { dir, spotMom, momDir }, dir);
      continue;
    }

    // The book must not be pricing against us either.
    if ((dir === "YES" && skew < 0) || (dir === "NO" && skew > 0)) {
      note(p.id, "rejected", "book prices against the direction", { dir, skew }, dir);
      continue;
    }

    // Spot has to sit on the right side of the strike for the direction taken.
    if (km.strike != null && s.price) {
      if (!km.strikeType) {
        note(p.id, "rejected", "unsupported contract rule", { strike: km.strike }, dir);
        continue;
      }
      const yesInMoney = km.strikeType === "floor" ? s.price >= km.strike : s.price <= km.strike;
      if (dir === "YES" && !yesInMoney) {
        note(p.id, "rejected", "spot is outside the YES side of the strike", { spot: s.price, strike: km.strike }, dir);
        continue;
      }
      if (dir === "NO" && yesInMoney) {
        note(p.id, "rejected", "spot is outside the NO side of the strike", { spot: s.price, strike: km.strike }, dir);
        continue;
      }
    }

    // Cushion gate: too close to the strike relative to how much this pair can
    // still move is a coin flip no matter how confident the score looks.
    if (km.strike != null && sigma > 0 && Math.abs(sigmaDist) < T.minSigmaDist) {
      note(
        p.id,
        "rejected",
        "spot too close to the strike to be safe",
        { sigmaDist: Number(sigmaDist.toFixed(2)), min: T.minSigmaDist },
        dir,
      );
      continue;
    }

    // Price the trade honestly: calibrated probability vs. what we actually pay.
    const entry = Math.min(
      0.99,
      Math.max(0.01, (dir === "YES" ? km.yesAsk || ym + km.spread / 2 : km.noAsk || 1 - ym + km.spread / 2)),
    );
    const calibrated = calibrateFor(p.id, conf, calibration, pairCalibration);
    const calibrationReady = (bucketFor(conf, calibration)?.n ?? 0) >= MIN_SAMPLES;
    const ev = evPerDollar(calibrated, entry);

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
        sigmaDist: Number(sigmaDist.toFixed(2)),
        lagDetected,
      },
      dir,
    );


    out.push({
      id: `${p.id}-${Math.floor(c.elapsed / 5)}-${dir}`,
      pair: p.id,
      dir,
      conf: Math.min(conf, 99),
      yesMid: ym,
      spread: km.spread,
      spotMom,
      kMom,
      lagDetected,
      calibrated,
        calibrationReady,
      entry,
      ev,
      sigmaDist,
      skew,
      reason: `${calibrationReady ? `Betting ${dir} at ${(entry * 100).toFixed(0)}¢ · conservative edge ${(ev * 100).toFixed(0)}% per $` : `Shadow ${dir} at ${(entry * 100).toFixed(0)}¢ · probability unproven`} · cushion ${sigmaDist >= 0 ? "+" : ""}${sigmaDist.toFixed(2)}σ from strike · skew ${(Math.abs(skew) * 100).toFixed(1)}% ${dir} · BRTI momentum ${spotMom >= 0 ? "+" : ""}${(spotMom * 100).toFixed(3)}%.${lagNote}`,
      elapsed: c.elapsed,
      remain: c.remain,
    });
  }

  flush();
  // Rank by expected value per dollar risked, not raw confidence: paying 80¢
  // for an 88% shot is worse than paying 45¢ for the same read.
  return out.sort((a, b) => b.ev - a.ev || b.conf - a.conf);
}

