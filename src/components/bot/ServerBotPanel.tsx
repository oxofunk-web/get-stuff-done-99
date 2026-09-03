import { useEffect, useState } from "react";

import { getServerBot, type ServerBotState } from "@/lib/bot/serverbot.functions";

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/**
 * Read-only heartbeat for the server runner — the single engine that places
 * all trades, even while the app is closed. Every control (on/off, mode, bet
 * size, caps) lives in the Auto-Trade Engine panel above; this panel just
 * proves the runner is alive and says what it did on its last tick.
 */
export function ServerBotPanel() {
  const [state, setState] = useState<ServerBotState | null>(null);

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const s = await getServerBot();
        if (!stop) setState(s);
      } catch {
        // keep last known state on a transient failure
      }
    };
    void pull();
    const i = setInterval(() => void pull(), 15000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, []);

  const enabled = state?.enabled ?? false;
  const live = state?.effectiveMode === "live";
  const status = !state
    ? { text: "…", cls: "border-wire bg-surface-2 text-dim" }
    : !enabled
      ? { text: "OFF", cls: "border-wire bg-surface-2 text-dim" }
      : live
        ? { text: "LIVE", cls: "border-no/50 bg-no/10 text-no" }
        : state.liveConfirmed || state.requestedMode === "live"
          ? { text: "PAPER · WARMUP", cls: "border-gold/50 bg-gold/10 text-gold" }
          : { text: "PAPER", cls: "border-yes/40 bg-yes/10 text-yes" };

  return (
    <section className="panel">
      <div className="panel-head">
        <span>Server Runner · trades with app closed</span>
        <span className={`rounded border px-1.5 py-0.5 text-[8px] font-bold tracking-widest ${status.cls}`}>
          {status.text}
        </span>
      </div>

      <div className="p-3">
        <p className="text-[8px] leading-relaxed text-dim">
          Last tick {ago(state?.lastTickAt ?? null)}
          {state?.lastTickMsg ? ` — ${state.lastTickMsg}` : ""}. This is the only engine that
          places orders; the controls in Auto-Trade Engine above drive it. It records the tape even
          while off.
        </p>
        {live ? (
          <p className="mt-1.5 rounded-md border border-no/40 bg-no/10 px-3 py-2 text-[9px] font-bold text-no">
            SERVER IS PLACING REAL ORDERS — even with the app closed.
          </p>
        ) : null}
      </div>
    </section>
  );
}
