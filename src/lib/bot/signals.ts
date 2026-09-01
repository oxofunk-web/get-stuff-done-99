import { candleInfo } from "./candle";
import {
  CLOSE_SECS,
  GATE_SECS,
  LAG_PCT,
  MAX_SPREAD,
  MAX_YES_MID,
  MIN_SKEW,
  MIN_TICKS,
  MIN_YES_MID,
  PAIRS,
  THRESHOLD,
} from "./constants";
import type { PairId } from "./constants";
import type { KalshiMarket, LagState, Signal, SpotState } from "./types";

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
  ) => {
    trace.push({ pair, verdict, reason, detail });
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

  const c = candleInfo(now);
  if (c.elapsed < GATE_SECS || c.elapsed >= CLOSE_SECS) {
    for (const p of PAIRS)
      note(p.id, "rejected", "outside the trade window", {
        elapsed: c.elapsed,
        gate: GATE_SECS,
        close: CLOSE_SECS,
      });
    flush();
    return [];
  }

  const out: Signal[] = [];

  for (const p of PAIRS) {
    const s = spot[p.id];
    const km = markets[p.id];
    if (!s || !km || s.ticks.length < MIN_TICKS) {
      note(p.id, "rejected", "not enough live data yet", {
        hasSpot: Boolean(s),
        hasMarket: Boolean(km),
        ticks: s?.ticks.length ?? 0,
        needTicks: MIN_TICKS,
      });
      continue;
    }

    // Liquidity / pricing quality gates.
    if (km.spread > MAX_SPREAD) {
      note(p.id, "rejected", "book too wide", { spread: km.spread, max: MAX_SPREAD });
      continue;
    }
    if (km.yesMid < MIN_YES_MID || km.yesMid > MAX_YES_MID) {
      note(p.id, "rejected", "mid outside tradable band", {
        yesMid: km.yesMid,
        min: MIN_YES_MID,
        max: MAX_YES_MID,
      });
      continue;
    }

    const spotMom = spotMomentum(s);
    const spotMidMom = midMomentum(s);
    const ym = km.yesMid;
    const skew = ym - 0.5;
    const kMom = kalshiMomentum(history[p.id], ym);

    // The book has to actually lean one way — coin-flip mids are noise.
    if (Math.abs(skew) < MIN_SKEW) {
      note(p.id, "rejected", "book too flat", { skew, min: MIN_SKEW });
      continue;
    }

    const lagDetected = Math.abs(spotMom) > LAG_PCT && Math.abs(kMom) < 0.008;
    const lagDir: "YES" | "NO" = spotMom > 0 ? "YES" : "NO";

    const liq = km.spread < 0.02 ? 1.05 : km.spread < 0.04 ? 0.9 : km.spread < 0.06 ? 0.75 : 0.55;

    const minuteIn = (c.elapsed - GATE_SECS) / 60;
    const tFac = minuteIn < 2 ? 1.0 : minuteIn < 3 ? 0.88 : 0.72;

    const sDir = Math.sign(spotMom || spotMidMom);
    const skDir = Math.sign(skew);
    const kDir = Math.sign(kMom);
    const agreement =
      sDir === skDir && skDir === kDir ? 1.35 : sDir === skDir || skDir === kDir ? 1.05 : 0.6;

    const lagBoost = lagDetected ? 1.3 : 1.0;
    const raw =
      Math.abs(skew) * 0.45 +
      (Math.abs(spotMom) / LAG_PCT) * 0.35 +
      (Math.abs(kMom) / 0.008) * 0.2;
    const strength = raw * agreement * liq * tFac * lagBoost;
    const conf = 50 + Math.min(strength / 0.35, 1) * 49;

    if (conf < THRESHOLD) {
      note(p.id, "rejected", "confidence below threshold", {
        conf: Number(conf.toFixed(1)),
        threshold: THRESHOLD,
        agreement,
        liq,
      });
      continue;
    }

    let dir: "YES" | "NO";
    if (lagDetected && Math.abs(spotMom) > LAG_PCT * 1.5) dir = lagDir;
    else if (sDir === skDir) dir = sDir > 0 ? "YES" : "NO";
    else if (Math.abs(skew) > (Math.abs(spotMom) / LAG_PCT) * 0.01)
      dir = skew > 0 ? "YES" : "NO";
    else dir = spotMom > 0 ? "YES" : "NO";

    // Spot momentum must not fight the chosen direction.
    const momDir = Math.sign(spotMom || spotMidMom);
    if (momDir !== 0 && ((dir === "YES" && momDir < 0) || (dir === "NO" && momDir > 0))) {
      note(p.id, "rejected", "spot momentum fights the direction", { dir, spotMom, momDir });
      continue;
    }

    // The book must not be pricing against us either.
    if ((dir === "YES" && skew < 0) || (dir === "NO" && skew > 0)) {
      note(p.id, "rejected", "book prices against the direction", { dir, skew });
      continue;
    }

    // Spot has to sit on the right side of the strike for the direction taken.
    if (km.strike != null && s.price) {
      if (dir === "YES" && s.price < km.strike) {
        note(p.id, "rejected", "spot below strike for a YES", { spot: s.price, strike: km.strike });
        continue;
      }
      if (dir === "NO" && s.price > km.strike) {
        note(p.id, "rejected", "spot above strike for a NO", { spot: s.price, strike: km.strike });
        continue;
      }
    }

    const lagNote = lagDetected
      ? ` BRTI LAG — spot ${spotMom > 0 ? "accelerating up" : "dropping"} (${(spotMom * 100).toFixed(3)}%) while the Kalshi book hasn't moved.`
      : "";

    note(p.id, "fired", `${dir} at ${(ym * 100).toFixed(0)}¢`, {
      conf: Number(conf.toFixed(1)),
      skew,
      spotMom,
      kMom,
      lagDetected,
    });

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
      reason: `Betting ${dir} at ${(ym * 100).toFixed(0)}¢ · skew ${(Math.abs(skew) * 100).toFixed(1)}% ${dir} · BRTI momentum ${spotMom >= 0 ? "+" : ""}${(spotMom * 100).toFixed(3)}% · Kalshi Δ${kMom >= 0 ? "+" : ""}${(kMom * 100).toFixed(2)}¢.${lagNote}`,
      elapsed: c.elapsed,
      remain: c.remain,
    });
  }

  flush();
  return out.sort((a, b) => b.conf - a.conf);
}
