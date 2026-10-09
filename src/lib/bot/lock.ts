import type { DirectionCall } from "./direction";

export type Phase = "WATCHING" | "CALL" | "FINAL";

export const CALL_WINDOW_SECS = 300; // entries from 5:00 — wider window, more shots
export const FINAL_SECS = 840; // last minute frozen
export const LOCK_PROB = 70;
export const LOCK_HOLD_MS = 10_000;
export const FLIP_PROB = 70; // opposite side must be this strong...
export const FLIP_HOLD_MS = 20_000; // ...for this long
/** Price must sit at least this % beyond the open before a call can lock. */
export const LOCK_CUSHION_PCT = 0.03;
/** Locks may only form up to this mark (the 10s hold must complete by 8:00). */
export const LOCK_FORM_END_SECS = 480;

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
  // First lock wins the candle: once locked, never flip; only track its prob.
  if (s.dir) return call.dir === s.dir ? { ...s, prob: call.prob } : s;
  // Locks may only form in minutes 0–5; after that an unlocked coin sits out.
  if (!call.ready || call.elapsed > LOCK_FORM_END_SECS) return { ...s, candidateDir: null, candidateSince: null };

  const wants = call.prob >= LOCK_PROB ? call.dir : null;
  if (!wants) return { ...s, candidateDir: null, candidateSince: null };
  // A lock needs price decisively on that side of the open.
  {
    const cushion = call.open * (LOCK_CUSHION_PCT / 100);
    const onSide =
      wants === "UP" ? call.now > call.open + cushion : call.now < call.open - cushion;
    if (!onSide) return { ...s, candidateDir: null, candidateSince: null };
  }
  const since = s.candidateDir === wants && s.candidateSince ? s.candidateSince : now;
  if (now - since < LOCK_HOLD_MS) return { ...s, candidateDir: wants, candidateSince: since };
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
    flips: 0,
  };
}
