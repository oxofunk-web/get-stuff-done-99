import { useEffect, useState } from "react";

import { mmss } from "@/lib/bot/candle";
import type { DirectionCall } from "@/lib/bot/direction";
import { CALL_WINDOW_SECS, FINAL_SECS, LOCK_FORM_START_SECS, LOCK_PROB, phaseOf } from "@/lib/bot/lock";
import { useLockedCalls } from "@/hooks/useLockedCalls";
import { getTradeAlerts } from "@/lib/alerts.functions";

type Alerts = Awaited<ReturnType<typeof getTradeAlerts>>;
const edgeOf = (msg: string | null) => msg?.match(/edge \+([\d.]+)¢/)?.[1];
const sideOf = (msg: string | null) => msg?.match(/· (YES|NO) @/)?.[1];

const rate = (t?: { wins: number; losses: number }) => {
  const n = (t?.wins ?? 0) + (t?.losses ?? 0);
  return n ? `${Math.round(((t?.wins ?? 0) / n) * 100)}% (${n})` : "—";
};

/** Steady last-7-minute calls plus the Kalshi target for the locked side. Read-only. */
export function LockPanel({ calls }: { calls: DirectionCall[] }) {
  const [alert, setAlert] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { lockOf, score, flash, resetScore } = useLockedCalls(calls, alert);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  useEffect(() => {
    const load = () => getTradeAlerts().then(setAlerts).catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);
  const cur = Math.floor(Date.now() / 900_000) * 900_000;

  return (
    <section className="panel mt-3">
      <div className="panel-head">
        <span>Locked call — last 7 minutes</span>
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
          if (l.dir)
            label = `${phase === "FINAL" ? "FINAL" : "CALL"}: ${l.dir} ${l.prob.toFixed(0)}% · locked ${mmss(l.lockSec ?? 0)}`;
          else if (c.elapsed >= FINAL_SECS) label = "no lock this candle — sitting out";
          else if (c.elapsed < LOCK_FORM_START_SECS) label = "WATCHING · locks from 8:00";
          else if (l.candidateDir) label = `confirming ${l.candidateDir}…`;
          else label = c.ready ? `WATCHING · leaning ${c.dir} ${c.prob.toFixed(0)}%` : "WATCHING";
          // Kalshi target only when it matches the locked direction — never a conflicting side.
          const t = l.dir
            ? (alerts?.alerts ?? []).find((a) => a.pair === c.pair && a.candle_id === cur && a.dir === l.dir)
            : undefined;
          return (
            <div key={c.pair} className="px-3 py-2 text-[10px]">
              <div className="flex items-center gap-2">
                <b className="w-12 font-sans text-foreground">{c.pair}</b>
                <span className="font-bold tracking-widest" style={{ color }}>
                  {label}
                </span>
              </div>
              {l.dir ? (
                <div className="mt-1 pl-14 text-[9px] text-muted-foreground">
                  {t ? (
                    <>
                      BUY <b className="text-foreground">{sideOf(t.msg) ?? (l.dir === "UP" ? "YES" : "NO")}</b> @{" "}
                      <b className="text-foreground">{t.entry_price != null ? `${Math.round(t.entry_price * 100)}¢` : "—"}</b>
                      {" · "}STRIKE <b className="text-foreground">{t.strike ?? "—"}</b>
                      {" · "}EDGE <b className="text-yes">+{edgeOf(t.msg) ?? "?"}¢</b>
                      {" · "}SIZE <b className="text-foreground">{t.requested_contracts ?? 0} (${(t.stake ?? 0).toFixed(2)})</b>
                    </>
                  ) : (
                    "no Kalshi strike with edge in 50–85¢ yet"
                  )}
                </div>
              ) : null}
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
          {["BTC", "ETH", "SOL", "XRP"].map((p) => (
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
        <div className="mt-1 text-dim">Calls lock from {mmss(CALL_WINDOW_SECS)} after 10s above {LOCK_PROB}%.</div>
      </div>
    </section>
  );
}
