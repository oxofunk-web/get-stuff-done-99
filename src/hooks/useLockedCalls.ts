import { useEffect, useRef, useState } from "react";

import type { DirectionCall } from "@/lib/bot/direction";
import { emptyLock, stepLock, type LockState } from "@/lib/bot/lock";
import { getScorecard, recordLock, resetScorecard as resetScorecardFn } from "@/lib/lockcalls.functions";

const CANDLE_MS = 900_000;
type Score = Awaited<ReturnType<typeof getScorecard>>;

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {
    /* sound optional */
  }
}

/** Adds a steady locked call on top of the live reading — never changes it. */
export function useLockedCalls(calls: DirectionCall[], alert: boolean) {
  const locks = useRef<Record<string, LockState>>({});
  const [, force] = useState(0);
  const [score, setScore] = useState<Score | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const now = Date.now();
  const candleStart = Math.floor(now / CANDLE_MS) * CANDLE_MS;

  useEffect(() => {
    let changed = false;
    for (const c of calls) {
      const prev = locks.current[c.pair] ?? emptyLock(candleStart);
      const next = stepLock(prev, c, candleStart, now);
      if (next !== prev) {
        locks.current[c.pair] = next;
        changed = true;
      }
      if (next.lockedAt && next.lockedAt !== prev.lockedAt && next.dir) {
        void recordLock({
          data: {
            pair: c.pair as "BTC",
            candle_start: candleStart,
            lock_sec: Math.round(next.lockSec ?? 0),
            dir: next.dir,
            prob: next.prob,
            open_price: next.open,
            lock_price: next.lockPrice ?? c.now,
          },
        }).catch(() => {});
        setFlash(`${c.pair} ${next.dir}`);
        setTimeout(() => setFlash(null), 4000);
        if (alert) beep();
      }
    }
    if (changed) force((n) => n + 1);
  });

  const loadScore = () => getScorecard().then(setScore).catch(() => {});
  useEffect(() => {
    loadScore();
    const id = setInterval(loadScore, 60_000);
    return () => clearInterval(id);
  }, []);

  const resetScore = async () => {
    const r = await resetScorecardFn().catch(() => ({ ok: false }));
    if (r?.ok) loadScore();
    return r?.ok ?? false;
  };

  const lockOf = (pair: string) => {
    const l = locks.current[pair];
    return l && l.candleStart === candleStart ? l : emptyLock(candleStart);
  };
  return { lockOf, score, flash, resetScore };
}
