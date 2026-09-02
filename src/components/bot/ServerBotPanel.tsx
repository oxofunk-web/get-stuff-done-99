import { useCallback, useEffect, useState } from "react";

import {
  confirmServerLive,
  getServerBot,
  updateServerBot,
  type ServerBotState,
} from "@/lib/bot/serverbot.functions";

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/**
 * Controls for the server-side runner — the one that keeps trading while the
 * phone is locked. This panel is the kill switch: nothing here touches the
 * foreground bot in EnginePanel.
 */
export function ServerBotPanel() {
  const [state, setState] = useState<ServerBotState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getServerBot());
    } catch {
      // keep last known state on a transient failure
    }
  }, []);

  useEffect(() => {
    void refresh();
    const i = setInterval(() => void refresh(), 15000);
    return () => clearInterval(i);
  }, [refresh]);

  const act = useCallback(
    async (fn: () => Promise<ServerBotState | { ok: boolean; state?: ServerBotState; error?: string; hoursLeft?: number }>) => {
      setBusy(true);
      setNote(null);
      try {
        const res = await fn();
        if ("state" in res && res.state) setState(res.state);
        else if ("enabled" in res) setState(res as ServerBotState);
        if ("error" in res && res.error === "warmup") {
          setNote(`Live unlocks in ~${res.hoursLeft}h — the server paper-trades until then.`);
        }
      } catch (e) {
        setNote(e instanceof Error ? e.message : "update failed");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

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
        <span>Server Bot · trades with app closed</span>
        <span className={`rounded border px-1.5 py-0.5 text-[8px] font-bold tracking-widest ${status.cls}`}>
          {status.text}
        </span>
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between rounded-md border border-wire bg-surface-2 px-3 py-2.5">
          <span className="text-[8px] tracking-[0.2em] text-muted-foreground">RUN ON SERVER</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Toggle server bot"
              disabled={busy}
              onClick={() => void act(() => updateServerBot({ data: { enabled: !enabled } }))}
              className={`relative h-5 w-10 rounded-full border transition-colors disabled:opacity-50 ${
                enabled ? "border-yes bg-yes/25" : "border-wire bg-surface-3"
              }`}
            >
              <span
                className={`absolute top-0.5 size-3.5 rounded-full transition-all ${
                  enabled ? "left-[22px] bg-yes" : "left-0.5 bg-dim"
                }`}
              />
            </button>
            <span
              className={`font-sans text-[11px] font-bold tracking-widest ${enabled ? "text-yes" : "text-dim"}`}
            >
              {enabled ? "ON" : "OFF"}
            </span>
          </div>
        </div>

        <p className="mt-1.5 text-[8px] leading-relaxed text-dim">
          Last tick {ago(state?.lastTickAt ?? null)}
          {state?.lastTickMsg ? ` — ${state.lastTickMsg}` : ""}. The server records the tape even
          while off; orders only fire when ON.
        </p>

        {enabled && state ? (
          <>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {[5, 10, 15, 25].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => updateServerBot({ data: { betSize: n } }))}
                  className={`rounded-md border py-1.5 text-[11px] transition-colors disabled:opacity-50 ${
                    state.betSize === n
                      ? "border-yes/60 bg-yes/10 font-bold text-yes"
                      : "border-wire text-muted-foreground hover:border-dim"
                  }`}
                >
                  ${n}
                </button>
              ))}
            </div>

            <div className="mt-2 rounded-md border border-wire bg-surface-2 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[8px] tracking-[0.2em] text-muted-foreground">
                  MIN VALUE PER $1 RISKED
                </span>
                <span className="font-sans text-[12px] font-extrabold text-gold tabular-nums">
                  +{(state.evMargin * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={40}
                step={2}
                value={Math.round(state.evMargin * 100)}
                aria-label="Server bot minimum expected value per dollar risked"
                disabled={busy}
                onChange={(e) => void act(() => updateServerBot({ data: { evMargin: Number(e.target.value) / 100 } }))}
                className="mt-2 w-full accent-[var(--gold)]"
              />
            </div>

            {live ? (
              <div className="mt-2 rounded-md border border-no/40 bg-no/10 px-3 py-2">
                <p className="text-[9px] font-bold text-no">
                  SERVER IS PLACING REAL ORDERS — even with the app closed.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => updateServerBot({ data: { mode: "paper" } }))}
                  className="mt-1.5 w-full rounded-md border border-wire bg-surface-2 py-1.5 text-[10px] font-bold tracking-widest text-muted-foreground hover:border-dim disabled:opacity-50"
                >
                  BACK TO PAPER
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Enable LIVE server trading? Real Kalshi orders will be placed even while your phone is locked.",
                    )
                  ) {
                    void act(() => confirmServerLive());
                  }
                }}
                className="mt-2 w-full rounded-md border border-no/50 bg-no/10 py-2 text-[10px] font-bold tracking-widest text-no transition-colors hover:bg-no/20 disabled:opacity-50"
              >
                {state.warmupHoursLeft > 0
                  ? `LIVE UNLOCKS IN ~${Math.ceil(state.warmupHoursLeft)}H`
                  : "ENABLE LIVE (SERVER)"}
              </button>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => updateServerBot({ data: { enabled: false } }))}
              className="mt-2 w-full rounded-md border border-no/60 bg-no/15 py-2 text-[11px] font-extrabold tracking-widest text-no transition-colors hover:bg-no/25 disabled:opacity-50"
            >
              STOP SERVER BOT
            </button>
          </>
        ) : null}

        {note ? (
          <div className="mt-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-[9px] text-gold">
            {note}
          </div>
        ) : null}

        {state && state.recentTrades.length > 0 ? (
          <div className="mt-2 overflow-hidden rounded-md border border-wire">
            <div className="border-b border-wire bg-surface-2 px-2.5 py-1.5 text-[7px] tracking-[0.2em] text-dim">
              RECENT SERVER TRADES
            </div>
            {state.recentTrades.slice(0, 5).map((t) => (
              <div
                key={t.ts + t.pair}
                className="flex items-center justify-between border-b border-wire/50 bg-surface px-2.5 py-1.5 last:border-0"
              >
                <span className="text-[9px] text-foreground">
                  <span className={t.dir === "YES" ? "text-yes" : "text-no"}>{t.dir}</span> {t.pair}
                  <span className="text-dim"> · {t.mode}</span>
                </span>
                <span className="text-[8px] text-muted-foreground">
                  {t.outcome
                    ? `${t.outcome === "win" ? "+" : ""}$${(t.pnl ?? 0).toFixed(2)}`
                    : t.status}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
