import { useEffect, useState } from "react";

import { getAutoTrade } from "@/lib/autotrade.functions";

type State = Awaited<ReturnType<typeof getAutoTrade>>;

/**
 * Persistent execution-layer banner: shows whether orders fire (AUTO-TRADE
 * ON/OFF) and in which mode (LIVE/PAPER). The signal layer (locks) is
 * independent and keeps running either way.
 */
export function ExecutionBanner() {
  const [s, setS] = useState<State | null>(null);

  useEffect(() => {
    const load = () => getAutoTrade().then(setS).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const on = s?.enabled ?? false;
  const paper = s?.paper ?? true;

  return (
    <div
      className={`border-t border-wire/70 ${on ? "bg-yes/10" : "bg-no/10"}`}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`size-1.5 rounded-full ${on ? "animate-blink bg-yes" : "bg-no"}`}
          />
          <span
            className={`font-sans text-[10px] font-extrabold tracking-[0.15em] ${on ? "text-yes" : "text-no"}`}
          >
            AUTO-TRADE {on ? "ON" : "OFF"}
          </span>
          <span className="text-[9px] font-bold tracking-[0.2em] text-dim">
            · {paper ? "PAPER" : "LIVE"} MODE
          </span>
        </div>
        <p className="text-[9px] tracking-wide text-muted-foreground">
          {on
            ? paper
              ? "Orders fire on locked calls — simulated fills, no real money."
              : "Orders fire on locked calls — real money."
            : "AUTO-TRADE OFF — locks still form and grade, but no orders will fire."}
        </p>
      </div>
    </div>
  );
}
