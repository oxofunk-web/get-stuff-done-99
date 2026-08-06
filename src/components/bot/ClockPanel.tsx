import { mmss, phaseOf, type CandleInfo } from "@/lib/bot/candle";
import { CLOSE_SECS, GATE_SECS } from "@/lib/bot/constants";

const phaseMeta = {
  warmup: { label: "🔒 WARM-UP", tone: "text-dim", bar: "from-surface-3 to-dim" },
  approach: { label: "⏳ APPROACH", tone: "text-gold", bar: "from-gold to-gold/50" },
  trade: { label: "✅ TRADE WINDOW", tone: "text-yes", bar: "from-yes to-yes/50" },
  closing: { label: "🔴 CLOSING", tone: "text-no", bar: "from-no to-no/50" },
} as const;

const segs = [
  { label: "0–5m", sub: "WARM-UP", from: 0, to: 300 },
  { label: "5–10m", sub: "APPROACH", from: 300, to: 600 },
  { label: "10–14m", sub: "✅ TRADE", from: 600, to: 840 },
  { label: "14–15m", sub: "CLOSE", from: 840, to: 900 },
];

export function ClockPanel({ candle, ticker }: { candle: CandleInfo; ticker: string | null }) {
  const el = candle.elapsed;
  const phase = phaseOf(el);
  const meta = phaseMeta[phase];

  const window =
    el < GATE_SECS
      ? `trade opens in ${mmss(GATE_SECS - el)}`
      : el < CLOSE_SECS
        ? `${mmss(CLOSE_SECS - el)} left in window`
        : `closing in ${mmss(candle.remain)}`;

  return (
    <section className="panel">
      <div className="panel-head">
        <span>15-Minute Candle</span>
        <span className="text-[8px] tracking-widest text-dim">{ticker ?? "—"}</span>
      </div>
      <div className="p-3">
        <div className="flex items-end justify-between">
          <div>
            <div className={`font-sans text-[34px] font-extrabold leading-none tabular-nums ${meta.tone}`}>
              {mmss(candle.remain)}
            </div>
            <div className="mt-1 text-[8px] tracking-[0.2em] text-muted-foreground">TIME TO SETTLE</div>
          </div>
          <div className="text-right">
            <div className={`font-sans text-[11px] font-bold tracking-widest ${meta.tone}`}>
              {meta.label}
            </div>
            <div className="mt-1 text-[9px] text-muted-foreground">{window}</div>
          </div>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div
            className={`h-full bg-gradient-to-r ${meta.bar} transition-[width] duration-300`}
            style={{ width: `${candle.pct * 100}%` }}
          />
        </div>

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {segs.map((s) => {
            const active = el >= s.from && el < s.to;
            const past = el >= s.to;
            return (
              <div
                key={s.label}
                className={`rounded-md border px-1 py-1.5 text-center text-[8px] leading-tight ${
                  active
                    ? "border-yes/50 bg-yes/10 text-yes"
                    : past
                      ? "border-wire bg-surface-2 text-muted-foreground"
                      : "border-wire text-dim"
                }`}
              >
                <div className="font-bold">{s.label}</div>
                <div className="tracking-widest">{s.sub}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}