import { useState } from "react";

import { mmss } from "@/lib/bot/candle";
import type { DirectionCall } from "@/lib/bot/direction";
import { CALL_WINDOW_SECS, LOCK_PROB, phaseOf } from "@/lib/bot/lock";
import { useLockedCalls } from "@/hooks/useLockedCalls";

const rate = (t?: { wins: number; losses: number }) => {
  const n = (t?.wins ?? 0) + (t?.losses ?? 0);
  return n ? `${Math.round(((t?.wins ?? 0) / n) * 100)}% (${n})` : "—";
};

/** Steady last-5-minute calls plus a graded scorecard. Read-only. */
export function LockPanel({ calls }: { calls: DirectionCall[] }) {
  const [alert, setAlert] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { lockOf, score, flash, resetScore } = useLockedCalls(calls, alert);

  return (
    <section className="panel mt-3">
      <div className="panel-head">
        <span>Locked call — last 5 minutes</span>
        <button
          type="button"
          onClick={() => setAlert((a) => !a)}
          className="text-[8px] tracking-widest text-dim"
        >
          SOUND {alert ? "ON" : "OFF"}
        </button>
      </div>
      {flash ? (
        <div className="bg-gold/15 px-3 py-1.5 text-[10px] font-bold tracking-widest text-gold">
          CALL LOCKED: {flash}
        </div>
      ) : null}
      <div className="divide-y divide-wire">
        {calls.map((c) => {
          const l = lockOf(c.pair);
          const phase = phaseOf(c.elapsed);
          const color = l.dir === "UP" ? "var(--yes)" : l.dir === "DOWN" ? "var(--no)" : "var(--dim)";
          let label: string;
          if (phase === "WATCHING")
            label = c.ready ? `WATCHING · leaning ${c.dir} ${c.prob.toFixed(0)}%` : "WATCHING";
          else if (l.dir)
            label = `${phase === "FINAL" ? "FINAL" : "CALL"}: ${l.dir} ${l.prob.toFixed(0)}% · locked ${mmss(l.lockSec ?? 0)}`;
          else if (phase === "FINAL") label = "FINAL: no clear call";
          else label = l.candidateDir ? `confirming ${l.candidateDir}…` : `waiting for ≥${LOCK_PROB}%`;
          return (
            <div key={c.pair} className="flex items-center gap-2 px-3 py-2 text-[10px]">
              <b className="w-9 font-sans text-foreground">{c.pair}</b>
              <span className="font-bold tracking-widest" style={{ color }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-wire px-3 py-2 text-[9px] text-muted-foreground">
        <div className="mb-1 flex items-center justify-between tracking-widest text-dim">
          <span>SCORECARD (graded vs real close)</span>
          <button
            type="button"
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                setTimeout(() => setConfirming(false), 4000);
                return;
              }
              setConfirming(false);
              void resetScore();
            }}
            className="text-[8px] tracking-widest text-dim hover:text-foreground"
          >
            {confirming ? "TAP TO CONFIRM" : "RESET"}
          </button>
        </div>
        <div className="flex flex-wrap gap-x-3">
          {["BTC", "ETH", "SOL", "XRP", "DOGE"].map((p) => (
            <span key={p}>
              {p} <b className="text-foreground">{rate(score?.byPair[p])}</b>
            </span>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3">
          {[10, 11, 12, 13].map((m) => (
            <span key={m}>
              min {m} <b className="text-foreground">{rate(score?.byMinute[String(m)])}</b>
            </span>
          ))}
        </div>
        <div className="mt-1 text-dim">Calls lock from {mmss(CALL_WINDOW_SECS)} after 20s above {LOCK_PROB}%.</div>
      </div>
    </section>
  );
}
