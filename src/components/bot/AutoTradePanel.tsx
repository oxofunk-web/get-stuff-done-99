import { useEffect, useState } from "react";

import { getAutoTrade, resetPaperBank, setAutoTrade } from "@/lib/autotrade.functions";

type State = Awaited<ReturnType<typeof getAutoTrade>>;

/** Auto-trade on locked calls. Runs on the server, even with the app closed. */
export function AutoTradePanel() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);

  useEffect(() => {
    const load = () => getAutoTrade().then(setS).catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  const save = async (data: { enabled?: boolean; paper?: boolean; size?: number }) => {
    if (data.enabled && !window.confirm(`Turn on AUTO-TRADE with real money at $${s?.size ?? 10} per locked call?`)) return;
    if (data.paper === false && !window.confirm("Turn OFF paper mode? The bot will place REAL orders with REAL money on Kalshi.")) return;
    setBusy(true);
    try {
      setS(await setAutoTrade({ data }));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't save the setting");
      getAutoTrade().then(setS).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const cur = Math.floor(Date.now() / 900_000) * 900_000;
  return (
    <section className="panel mt-3">
      <div className="panel-head">
        <span>Auto-trade on locked calls</span>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={busy || !s}
            title={s?.paper ? "Paper mode: simulated fills, no real money" : "LIVE: real orders, real money"}
            onClick={() => void save({ paper: !s?.paper })}
            className={`rounded border px-2 py-px text-[9px] font-bold tracking-widest ${
              s?.paper ? "border-sky-400/50 bg-sky-400/15 text-sky-300" : "border-red-400/50 bg-red-400/15 text-red-300"
            }`}
          >
            {s?.paper ? "PAPER" : "LIVE"}
          </button>
          <button
            type="button"
            disabled={busy || !s}
            onClick={() => void save({ enabled: !s?.enabled })}
            className={`rounded border px-2 py-px text-[9px] font-bold tracking-widest ${
              s?.enabled ? "border-yes/50 bg-yes/15 text-yes" : "border-wire text-dim"
            }`}
          >
            AUTO-TRADE {s?.enabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 text-[9px] tracking-widest text-muted-foreground">
        SIZE $
        <input
          type="number"
          min={1}
          max={10000}
          disabled={busy}
          value={sizeDraft ?? String(s?.size ?? 10)}
          onChange={(e) => setSizeDraft(e.target.value)}
          onBlur={() => {
            const v = Math.floor(Number(sizeDraft));
            setSizeDraft(null);
            if (Number.isFinite(v) && v >= 1 && v <= 10000 && v !== s?.size) void save({ size: v });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-20 rounded border border-wire bg-transparent px-2 py-0.5 font-bold text-foreground"
        />
        <span className="normal-case tracking-normal">{s?.paper ? "live size (paper uses bank sizing)" : "per locked call"}</span>
        <span className="ml-auto">
          PAPER BANK <b className="text-foreground">${(s?.paperBankroll ?? 100).toFixed(2)}</b>
        </span>
      </div>
      <div className="divide-y divide-wire border-t border-wire">
        {(s?.trades ?? []).filter((t) => t.candle_id === cur).map((t) => (
          <div key={t.pair + t.candle_id} className="px-3 py-1.5 text-[10px]">
            <b className="font-sans text-foreground">{t.pair}</b>{" "}
            <span className={t.status === "placed" ? "text-yes" : "text-gold"}>
              {t.status === "placed" ? `FILLED ${t.dir} · ${t.msg}` : `SKIPPED · ${t.msg}`}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-wire px-3 py-2 text-[8px] leading-relaxed text-dim">
        One trade per coin per candle, only when its call locks. Runs on the server every minute,
        even with this app closed. {s?.paper ? "Paper mode: fills are simulated, no money moves. " : ""}
        {s?.lastMsg ? `Last check: ${s.lastMsg}` : ""}
      </div>
    </section>
  );
}
