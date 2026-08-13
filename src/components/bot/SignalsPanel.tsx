import { mmss } from "@/lib/bot/candle";
import { CLOSE_SECS, GATE_SECS, PAIRS, THRESHOLD } from "@/lib/bot/constants";
import type { CandleInfo } from "@/lib/bot/candle";
import type { Signal, TradeStatus } from "@/lib/bot/types";

interface Props {
  signals: Signal[];
  candle: CandleInfo;
  tradeStatus: Record<string, { status: TradeStatus; msg: string }>;
}

export function SignalsPanel({ signals, candle, tradeStatus }: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <span>Signals — {THRESHOLD}%+ Confidence</span>
        {signals.length > 0 ? (
          <span className="animate-blink rounded-full border border-yes/30 bg-yes/10 px-2 py-px text-[7px] tracking-widest text-yes">
            LIVE
          </span>
        ) : null}
      </div>

      <div className="max-h-[420px] space-y-2 overflow-y-auto p-2.5">
        {signals.length === 0 ? (
          <EmptyState candle={candle} />
        ) : (
          signals.map((s) => {
            const pair = PAIRS.find((p) => p.id === s.pair)!;
            const isYes = s.dir === "YES";
            const accent = s.lagDetected ? "var(--gold)" : isYes ? "var(--yes)" : "var(--no)";
            const st = tradeStatus[s.id];
            return (
              <article
                key={s.id}
                className="relative overflow-hidden rounded-md border bg-surface-2 p-2.5"
                style={{ borderColor: `color-mix(in oklab, ${accent} 45%, transparent)` }}
              >
                <div
                  className="absolute inset-y-0 left-0 opacity-[0.07]"
                  style={{ width: `${s.conf}%`, background: accent }}
                />
                <div className="relative">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="rounded px-1.5 py-px font-sans text-[9px] font-bold tracking-widest"
                        style={{ background: `color-mix(in oklab, ${accent} 18%, transparent)`, color: accent }}
                      >
                        {s.lagDetected ? "⚡ LAG" : isYes ? "▲ YES" : "▼ NO"}
                      </span>
                      <span className={`font-sans text-[12px] font-extrabold ${pair.colorClass}`}>
                        {s.pair}
                      </span>
                      <span className="rounded border border-wire px-1 text-[7px] tracking-widest text-dim">
                        15M
                      </span>
                    </div>
                    <div className="text-right">
                      <div
                        className="font-sans text-[17px] font-extrabold leading-none tabular-nums"
                        style={{ color: accent }}
                      >
                        {s.conf.toFixed(1)}%
                      </div>
                      <div className="text-[7px] tracking-[0.2em] text-dim">CONFIDENCE</div>
                    </div>
                  </div>

                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full" style={{ width: `${s.conf}%`, background: accent }} />
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px] tracking-widest text-muted-foreground">
                    <span>
                      PRICE <b className="text-foreground">{(s.yesMid * 100).toFixed(0)}¢</b>
                    </span>
                    <span>
                      SPREAD <b className="text-foreground">{(s.spread * 100).toFixed(1)}¢</b>
                    </span>
                    <span>
                      BRTI Δ{" "}
                      <b className="text-foreground">
                        {s.spotMom >= 0 ? "+" : ""}
                        {(s.spotMom * 100).toFixed(3)}%
                      </b>
                    </span>
                    <span>
                      CLOSES <b className="text-foreground">{mmss(s.remain)}</b>
                    </span>
                  </div>

                  <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">{s.reason}</p>

                  {st ? (
                    <div
                      className={`mt-2 rounded border px-2 py-1 text-[9px] ${
                        st.status === "placed"
                          ? "border-yes/40 bg-yes/10 text-yes"
                          : st.status === "failed"
                            ? "border-no/40 bg-no/10 text-no"
                            : "border-gold/40 bg-gold/10 text-gold"
                      }`}
                    >
                      {st.status === "pending" ? "⏳ " : st.status === "placed" ? "✅ " : "❌ "}
                      {st.msg}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function EmptyState({ candle }: { candle: CandleInfo }) {
  const { elapsed, remain } = candle;
  const state =
    elapsed < GATE_SECS
      ? { icon: "🔒", txt: "Trade window opens at the 8:00 mark", sub: "Monitoring BRTI & Kalshi in background" }
      : elapsed >= CLOSE_SECS
        ? { icon: "⌛", txt: "Closing zone — no new entries", sub: `Next candle in ${mmss(remain)}` }
        : { icon: "🔍", txt: `Scanning — no ${THRESHOLD}%+ signal yet`, sub: "BRTI & Kalshi updating in real time" };

  return (
    <div className="py-10 text-center">
      <div className="text-2xl">{state.icon}</div>
      <div className="mt-2 text-[11px] text-foreground">{state.txt}</div>
      <div className="mt-1 text-[9px] text-dim">{state.sub}</div>
    </div>
  );
}