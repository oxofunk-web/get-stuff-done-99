import { useState } from "react";

import { CandleChart } from "./CandleChart";
import { CallPanel } from "./CallPanel";
import { LockPanel } from "./LockPanel";
import { ExecutionBanner } from "./ExecutionBanner";
import { TradeAlertsPanel } from "./TradeAlertsPanel";
import { useDirection } from "@/hooks/useDirection";
import { fmtPrice, mmss } from "@/lib/bot/candle";
import { PAIRS, type PairId } from "@/lib/bot/constants";

export function Dashboard() {
  const d = useDirection();
  const [pair, setPair] = useState<PairId>("BTC");
  const call = d.calls.find((c) => c.pair === pair) ?? d.calls[0]!;
  const meta = PAIRS.find((p) => p.id === pair);
  const up = call.dir === "UP";
  const accent = !call.ready ? "var(--dim)" : up ? "var(--yes)" : "var(--no)";

  return (
    <div className="relative z-1 min-h-screen">
      <header className="sticky top-0 z-40 border-b border-wire bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`size-1.5 rounded-full ${d.status === "live" ? "animate-blink bg-yes" : "bg-dim"}`}
            />
            <div>
              <h1 className="truncate font-sans text-[15px] font-extrabold text-hi">
                BOTTE-BY-OXOFUNK
              </h1>
              <p className="text-[7px] tracking-[0.25em] text-muted-foreground">
                15M DIRECTION READER · UP OR DOWN
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-sans text-[15px] font-extrabold leading-none tabular-nums text-hi">
              {mmss(d.candle.remain)}
            </div>
            <div className="text-[7px] tracking-[0.2em] text-dim">CANDLE CLOSES</div>
          </div>
        </div>
        <ExecutionBanner />
        <div className="border-t border-wire/70 bg-surface/70">
          <div className="mx-auto grid max-w-[1180px] grid-cols-5">
            {PAIRS.map((p) => {
              const c = d.calls.find((x) => x.pair === p.id);
              const isUp = c?.dir === "UP";
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPair(p.id)}
                  className={`border-r border-wire px-2 py-2.5 text-left last:border-r-0 ${pair === p.id ? "bg-surface-2" : ""}`}
                >
                  <div className={`font-sans text-[11px] font-extrabold ${p.colorClass}`}>{p.id}</div>
                  <div className="text-[11px] tabular-nums text-hi">{fmtPrice(c?.now ?? 0)}</div>
                  <div
                    className="text-[8px] font-bold tracking-widest"
                    style={{ color: !c?.ready ? "var(--dim)" : isUp ? "var(--yes)" : "var(--no)" }}
                  >
                    {c?.ready ? (isUp ? `▲ UP ${c.prob.toFixed(0)}%` : `▼ DOWN ${c.prob.toFixed(0)}%`) : "READING…"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-12">
          <section className="panel lg:col-span-7">
            <div className="panel-head">
              <span>
                {meta?.name ?? pair} · 15-minute chart
              </span>
              <span
                className="rounded px-1.5 py-px font-sans text-[9px] font-bold tracking-widest"
                style={{
                  background: `color-mix(in oklab, ${accent} 18%, transparent)`,
                  color: accent,
                }}
              >
                {call.ready ? (up ? "FINISHING UP" : "FINISHING DOWN") : "READING…"}
              </span>
            </div>
            <CandleChart candles={d.seriesFor(pair)} openLine={call.open} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-wire px-3 py-1.5 text-[8px] tracking-widest text-muted-foreground">
              <span>
                OPEN <b className="text-foreground">{fmtPrice(call.open)}</b>
              </span>
              <span>
                NOW <b className="text-foreground">{fmtPrice(call.now)}</b>
              </span>
              <span>
                MOVE{" "}
                <b style={{ color: call.delta >= 0 ? "var(--yes)" : "var(--no)" }}>
                  {call.delta >= 0 ? "+" : "−"}
                  {Math.abs(call.deltaPct).toFixed(3)}%
                </b>
              </span>
              <span className="ml-auto flex items-center gap-2">
                <span
                  className={`flex items-center gap-1 rounded-full border px-2 py-px text-[7px] tracking-widest ${
                    d.status === "live"
                      ? "border-yes/30 bg-yes/10 text-yes"
                      : "border-gold/40 bg-gold/10 text-gold"
                  }`}
                >
                  <span className="size-1 rounded-full bg-current animate-blink" />
                  {d.status === "live" ? `LIVE · ${d.source.toUpperCase()}` : "RECONNECTING"}
                </span>
                {d.chartOk === false ? (
                  <button
                    type="button"
                    onClick={() => void d.refreshCandles()}
                    className="rounded border border-no/50 bg-no/10 px-2 py-px text-[8px] font-bold tracking-widest text-no"
                  >
                    RETRY CHART
                  </button>
                ) : null}
              </span>
            </div>
          </section>

          <div className="lg:col-span-5">
            <TradeAlertsPanel />
            <CallPanel calls={d.calls} selected={pair} onSelect={(p) => setPair(p as PairId)} />
            <LockPanel calls={d.calls} />
          </div>
        </div>

        <footer className="pb-8 pt-3">
          <p className="rounded-md border border-wire bg-surface p-3 text-[9px] leading-relaxed text-muted-foreground">
            <strong className="text-foreground">RISK:</strong> live prices come from Coinbase
            with a Binance fallback and a server relay when your network blocks both. For each
            15-minute candle the reader compares the current price with the candle's open and how
            far the coin can still travel in the time left, then states whether the candle is
            finishing up or down and the chance of it. The bot runs in MANUAL mode: it raises trade
            alerts only and never places orders. Any trade you place yourself is your own decision.
            Trading involves risk of loss. Not financial advice.
          </p>
        </footer>
      </main>
    </div>
  );
}
