import { useEffect, useState } from "react";

import { getScalp, setScalp } from "@/lib/scalp.functions";

type State = Awaited<ReturnType<typeof getScalp>>;

/** AI candle-start scalper (BTC + ETH): buy ~50¢, sell +15¢ / -10¢ / at 6:00. */
export function ScalpPanel() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => getScalp().then(setS).catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const toggle = async () => {
    const on = !s?.enabled;
    if (on && !window.confirm(`Turn on the AI SCALPER with real money at $${s?.size ?? 10} per trade (BTC + ETH)?`)) return;
    setBusy(true);
    try {
      setS(await setScalp({ data: { enabled: on } }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel mt-3">
      <div className="panel-head">
        <span>AI scalper · BTC + ETH</span>
        <button
          type="button"
          disabled={busy || !s}
          onClick={() => void toggle()}
          className={`rounded border px-2 py-px text-[9px] font-bold tracking-widest ${
            s?.enabled ? "border-yes/50 bg-yes/15 text-yes" : "border-wire text-dim"
          }`}
        >
          SCALPER {s?.enabled ? "ON" : "OFF"}
        </button>
      </div>
      <div className="divide-y divide-wire border-t border-wire">
        {(s?.trades ?? []).map((t) => {
          const time = new Date(Number(t.candle_id)).toISOString().slice(11, 16);
          const label =
            t.status === "closed"
              ? `SOLD ${t.exit_reason?.toUpperCase()} · ${Math.round(Number(t.entry_price) * 100)}¢ → ${Math.round(Number(t.exit_price) * 100)}¢ · ${Number(t.pnl) >= 0 ? "+" : ""}$${Number(t.pnl).toFixed(2)}`
              : t.status === "placed"
                ? `HOLDING ${t.dir} · ${t.msg}`
                : `SKIPPED · ${t.msg}`;
          const tone =
            t.status === "closed" ? (Number(t.pnl) >= 0 ? "text-yes" : "text-no") : t.status === "placed" ? "text-yes" : "text-gold";
          return (
            <div key={t.id} className="px-3 py-1.5 text-[10px]">
              <span className="text-dim">{time}</span> <b className="font-sans text-foreground">{t.pair}</b>{" "}
              <span className={tone}>{label}</span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-wire px-3 py-2 text-[8px] leading-relaxed text-dim">
        At 0:30–2:00 of each candle the AI picks UP, DOWN or SKIP. Buys only at 45–55¢, sells at +15¢ profit,
        cuts at −10¢, or exits at 6:00. Uses the size chosen above. Runs on the server, app can be closed.{" "}
        {s?.lastMsg ? `Last: ${s.lastMsg}` : ""}
      </div>
    </section>
  );
}
