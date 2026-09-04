import { PAIRS } from "@/lib/bot/constants";
import type { TradeLogEntry } from "@/lib/bot/types";

export function LogPanel({ log }: { log: TradeLogEntry[] }) {
  return (
    <section className="panel flex-1">
      <div className="panel-head">
        <span>Trade Log</span>
        <span className="text-[8px] tracking-widest text-dim">LAST 30</span>
      </div>
      {log.length === 0 ? (
        <div className="p-5 text-center text-[10px] text-dim">No trades this session</div>
      ) : (
        <div className="divide-y divide-wire">
          {log.map((t) => {
            const pair = PAIRS.find((p) => p.id === t.pair)!;
            const isYes = t.dir === "YES";
            return (
              <div key={t.id} className="px-3 py-1.5">
                <div className="flex items-center gap-2 text-[9px]">
                  <span className="tabular-nums text-dim">{t.time}</span>
                  <span className={`font-sans font-bold ${pair.colorClass}`}>{t.pair}</span>
                  <span className={isYes ? "text-yes" : "text-no"}>{isYes ? "▲ YES" : "▼ NO"}</span>
                  <span className={`tabular-nums ${isYes ? "text-yes" : "text-no"}`}>
                    {t.conf.toFixed(1)}%
                  </span>
                  <span
                    className={`ml-auto rounded-full border px-1.5 py-px text-[7px] tracking-widest ${
                      t.status === "failed"
                        ? "border-no/30 bg-no/10 text-no"
                        : t.exitReason
                          ? "border-gold/30 bg-gold/10 text-gold"
                          : "border-yes/30 bg-yes/10 text-yes"
                    }`}
                  >
                    {t.status === "failed" ? "FAILED" : t.exitReason ? "CLOSED" : "LIVE"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[8px] text-muted-foreground">{t.msg}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}