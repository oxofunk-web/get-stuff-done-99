import type { DirectionCall } from "./direction";

export type Phase = "WATCHING" | "CALL" | "FINAL";

export const CALL_WINDOW_SECS = 600; // last 5 minutes start at 10:00
export const FINAL_SECS = 840; // last minute frozen
export const LOCK_PROB = 70;
export const LOCK_HOLD_MS = 20_000;
export const FLIP_PROB = 70; // opposite side must be this strong...
export const FLIP_HOLD_MS = 20_000; // ...for this long

export interface LockState {
  candleStart: number;
  dir: "UP" | "DOWN" | null;
  prob: number;
  lockedAt: number | null;
  lockSec: number | null;
  lockPrice: number | null;
  open: number;
  /** When the current candidate side first held above the lock level. */
  candidateDir: "UP" | "DOWN" | null;
  candidateSince: number | null;
  flips: number;
}

export function phaseOf(elapsed: number): Phase {
  if (elapsed >= FINAL_SECS) return "FINAL";
  if (elapsed >= CALL_WINDOW_SECS) return "CALL";
  return "WATCHING";
}

export function emptyLock(candleStart: number): LockState {
  return {
    candleStart,
    dir: null,
    prob: 0,
    lockedAt: null,
    lockSec: null,
    lockPrice: null,
    open: 0,
    candidateDir: null,
    candidateSince: null,
    flips: 0,
  };
}

/** Advance the lock for one fresh reading. Pure: returns the next state. */
export function stepLock(
  prev: LockState,
  call: DirectionCall,
  candleStart: number,
  now: number,
): LockState {
  let s = prev.candleStart === candleStart ? prev : emptyLock(candleStart);
  const phase = phaseOf(call.elapsed);
  if (!call.ready || phase === "WATCHING") return { ...s, candidateDir: null, candidateSince: null };
  if (phase === "FINAL") return s; // frozen

  const strong = call.prob >= (s.dir ? FLIP_PROB : LOCK_PROB);
  const wants = strong && call.dir !== s.dir ? call.dir : null;
  if (!wants) {
    if (s.dir && call.dir === s.dir) s = { ...s, prob: call.prob };
    return { ...s, candidateDir: null, candidateSince: null };
  }
  // Flip also needs price to be on the new side of the open.
  if (s.dir) {
    const onSide = wants === "UP" ? call.now > call.open : call.now < call.open;
    if (!onSide) return { ...s, candidateDir: null, candidateSince: null };
  }
  const since = s.candidateDir === wants && s.candidateSince ? s.candidateSince : now;
  const hold = s.dir ? FLIP_HOLD_MS : LOCK_HOLD_MS;
  if (now - since < hold) return { ...s, candidateDir: wants, candidateSince: since };
  return {
    ...s,
    dir: wants,
    prob: call.prob,
    lockedAt: now,
    lockSec: call.elapsed,
    lockPrice: call.now,
    open: call.open,
    candidateDir: null,
    candidateSince: null,
    flips: s.dir ? s.flips + 1 : 0,
  };
}
