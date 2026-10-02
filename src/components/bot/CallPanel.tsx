import { fmtPrice, mmss } from "@/lib/bot/candle";
import { PAIRS } from "@/lib/bot/constants";
import type { DirectionCall } from "@/lib/bot/direction";

interface Props {
  calls: DirectionCall[];
  selected: string;
  onSelect: (pair: string) => void;
}

/** One plain up/down call per coin for the 15-minute candle forming now. */
export function CallPanel({ calls, selected, onSelect }: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <span>This candle — up or down?</span>
        <span className="text-[8px] tracking-widest text-dim">VS CANDLE OPEN</span>
      </div>
      <div className="divide-y divide-wire">
        {calls.map((c) => {
          const pair = PAIRS.find((p) => p.id === c.pair);
          const up = c.dir === "UP";
          const accent = !c.ready ? "var(--dim)" : up ? "var(--yes)" : "var(--no)";
          const active = selected === c.pair;
          return (
            <button
              key={c.pair}
              type="button"
              onClick={() => onSelect(c.pair)}
              className={`w-full px-3 py-2.5 text-left transition-colors ${active ? "bg-surface-2" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="size-1.5 rounded-full" style={{ background: pair?.colorVar }} />
                <span className={`font-sans text-[12px] font-extrabold ${pair?.colorClass ?? "text-foreground"}`}>
                  {c.pair}
                </span>
                <span
                  className="rounded px-1.5 py-px font-sans text-[10px] font-bold tracking-widest"
                  style={{
                    background: `color-mix(in oklab, ${accent} 18%, transparent)`,
                    color: accent,
                  }}
                >
                  {c.ready ? (up ? "FINISHING UP" : "FINISHING DOWN") : "READING…"}
                </span>
                <span className="ml-auto text-right">
                  <span
                    className="block font-sans text-[16px] font-extrabold leading-none tabular-nums"
                    style={{ color: accent }}
                  >
                    {c.ready ? `${c.prob.toFixed(0)}%` : "—"}
                  </span>
                  <span className="text-[7px] tracking-[0.2em] text-dim">CHANCE</span>
                </span>
              </div>

              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full"
                  style={{ width: `${c.ready ? c.prob : 0}%`, background: accent }}
                />
              </div>

              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[8px] tracking-widest text-muted-foreground">
                <span>
                  OPEN <b className="text-foreground">{fmtPrice(c.open)}</b>
                </span>
                <span>
                  NOW <b className="text-foreground">{fmtPrice(c.now)}</b>
                </span>
                {c.predictedClose ? (
                  <span>
                    TARGET{" "}
                    <b className="text-foreground">~{fmtPrice(c.predictedClose)}</b>
                    {c.closeSigma ? <span className="text-dim"> ±{fmtPrice(c.closeSigma)}</span> : null}
                  </span>
                ) : null}
                <span>
                  MOVE{" "}
                  <b style={{ color: c.delta >= 0 ? "var(--yes)" : "var(--no)" }}>
                    {c.delta >= 0 ? "+" : "−"}
                    {Math.abs(c.deltaPct).toFixed(3)}%
                  </b>
                </span>
                <span>
                  CLOSES <b className="text-foreground">{mmss(c.remain)}</b>
                </span>
              </div>

              <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">{c.note}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
