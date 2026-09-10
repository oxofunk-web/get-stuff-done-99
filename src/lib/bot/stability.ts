import type { KalshiMarket, Signal } from "./types";

export const CANDLE_SECONDS = 900;
export const ORDER_CUTOFF_BUFFER_SECS = 5;
/** How many matching observations a signal needs to count. One read that
 * passes every other filter can fire immediately. */
export const REQUIRED_STABLE_SAMPLES = 1;
/** Minimum elapsed time the confirmation window must span. */
export const REQUIRED_STABLE_SPAN_MS = 0;
/** How much cushion decay is tolerated across the window, in sigma. */
export const CUSHION_DECAY_TOLERANCE = 0.15;


/** Exact UTC close boundary for the active 15-minute candle. */
export function activeCandleCloseMs(now = Date.now()) {
  const candleMs = CANDLE_SECONDS * 1000;
  return (Math.floor(now / candleMs) + 1) * candleMs;
}

/** Reject previous/next-candle contracts even when the exchange briefly lists both as open. */
export function marketMatchesActiveCandle(closeTime: string | null | undefined, now = Date.now()) {
  if (!closeTime) return false;
  const closeMs = new Date(closeTime).getTime();
  return Number.isFinite(closeMs) && Math.abs(closeMs - activeCandleCloseMs(now)) <= 2_000;
}

/** A final quote must still pass every direction-sensitive market check. */
export function freshMarketSupportsSignal(
  signal: Signal,
  market: KalshiMarket,
  spotPrice: number,
  maxSpread: number,
) {
  const skew = market.yesMid - 0.5;
  if (market.spread > maxSpread) return false;
  if (signal.dir === "YES" && skew < 0) return false;
  if (signal.dir === "NO" && skew > 0) return false;
  if (market.strike != null && spotPrice > 0) {
    if (!market.strikeType) return false;
    const yesInMoney = market.strikeType === "floor" ? spotPrice >= market.strike : spotPrice <= market.strike;
    if (signal.dir === "YES" && !yesInMoney) return false;
    if (signal.dir === "NO" && yesInMoney) return false;
  }
  return true;
}

export interface StableSignalCandidate {
  key: string;
  count: number;
  lastSeenAt: number;
  firstSeenAt: number;
  /** Best absolute cushion seen in this window, in sigma. */
  bestCushion: number;
}

/**
 * Several observations must agree on the same contract and direction, spread
 * over time, AND the cushion must not be decaying toward the strike. A read
 * that is shrinking is not stable no matter how often it repeats.
 */
export function advanceStableSignal(
  previous: StableSignalCandidate | undefined,
  key: string,
  now: number,
  minimumGapMs: number,
  cushion?: number,
): StableSignalCandidate {
  const abs = cushion == null ? 0 : Math.abs(cushion);
  const restart = (): StableSignalCandidate => ({
    key,
    count: 1,
    lastSeenAt: now,
    firstSeenAt: now,
    bestCushion: abs,
  });
  if (!previous || previous.key !== key || now - previous.lastSeenAt > 15_000) return restart();
  if (now - previous.lastSeenAt < minimumGapMs) return previous;
  if (cushion != null && abs < previous.bestCushion - CUSHION_DECAY_TOLERANCE) {
    // Cushion is collapsing toward the strike — start the window over.
    return restart();
  }
  return {
    key,
    count: previous.count + 1,
    lastSeenAt: now,
    firstSeenAt: previous.firstSeenAt,
    bestCushion: Math.max(previous.bestCushion, abs),
  };
}

/** A candidate only counts once it has enough samples across enough time. */
export function isStable(candidate: StableSignalCandidate | undefined) {
  if (!candidate) return false;
  return (
    candidate.count >= REQUIRED_STABLE_SAMPLES &&
    candidate.lastSeenAt - candidate.firstSeenAt >= REQUIRED_STABLE_SPAN_MS
  );
}
