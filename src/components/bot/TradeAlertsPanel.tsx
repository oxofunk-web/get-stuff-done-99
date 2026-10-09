import { useEffect, useState } from "react";

import { getTradeAlerts } from "@/lib/alerts.functions";

type State = Awaited<ReturnType<typeof getTradeAlerts>>;

const edgeOf = (msg: string | null) => msg?.match(/edge \+([\d.]+)¢/)?.[1];

/** MANUAL mode: the bot raises alerts on qualified setups and never places orders. */
export function TradeAlertsPanel() {
  const [s, setS] = useState<State | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => getTradeAlerts().then(setS).catch(() => {});
    load();
    const id = setInterval(() => { load(); setNow(Date.now()); }, 10_000);
    return () => clearInterval(id);
  }, []);

  const cur = Math.floor(now / 900_000) * 900_000;
  const minsLeft = Math.max(0, (cur + 840_000 - now) / 60_000);
  const live = (s?.alerts ?? []).filter((a) => a.candle_id === cur);

  return (
    <section className="panel mb-3 border-gold/50">
      <div className="panel-head">
        <span className="text-gold">Trade alerts</span>
        <span className="rounded border border-gold/50 bg-gold/15 px-2 py-px text-[9px] font-bold tracking-widest text-gold">
          MANUAL · NO ORDERS
        </span>
      </div>
      {live.length === 0 ? (
        <div className="px-3 py-3 text-[10px] text-muted-foreground">No qualified setup this candle yet.</div>
      ) : (
        <div className="divide-y divide-wire">
          {live.map((a) => {
            const up = a.dir === "UP";
            return (
              <div key={a.id} className="grid grid-cols-3 gap-x-3 gap-y-1 px-3 py-2.5 text-[10px] sm:grid-cols-6">
                <b className="font-sans text-[13px] text-hi">{a.pair}</b>
                <b style={{ color: up ? "var(--yes)" : "var(--no)" }}>{up ? "▲ UP" : "▼ DOWN"}</b>
                <span>STRIKE <b className="text-foreground">{a.strike ?? "—"}</b></span>
                <span>PRICE <b className="text-foreground">{a.entry_price != null ? `${Math.round(a.entry_price * 100)}¢` : "—"}</b></span>
                <span>EDGE <b className="text-yes">+{edgeOf(a.msg) ?? "?"}¢</b></span>
                <span>SIZE <b className="text-foreground">{a.requested_contracts ?? 0} (${(a.stake ?? 0).toFixed(2)})</b></span>
              </div>
            );
          })}
        </div>
      )}
      <div className="border-t border-wire px-3 py-2 text-[8px] leading-relaxed text-dim">
        {minsLeft.toFixed(1)} min left in the entry window. Alerts only — the bot never places orders.
        {s?.lastMsg ? ` Last check: ${s.lastMsg}` : ""}
      </div>
    </section>
  );
}
