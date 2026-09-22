import { fmtPrice } from "@/lib/bot/candle";
import type { Candle } from "@/lib/candles.functions";

interface Props {
  candles: Candle[];
  /** Highlight line: where the current candle opened. */
  openLine?: number | undefined;
  height?: number;
}

/**
 * The coin's own 15-minute candlestick chart. The last bar is the candle
 * forming right now, drawn from the live price feed.
 */
export function CandleChart({ candles, openLine, height = 190 }: Props) {
  const rows = candles.slice(-32);
  if (rows.length < 2) {
    return (
      <div className="flex h-[190px] items-center justify-center text-[10px] text-dim">
        Loading chart…
      </div>
    );
  }

  const W = 600;
  const H = height;
  const padT = 8;
  const padB = 14;
  const hi = Math.max(...rows.map((k) => k.h));
  const lo = Math.min(...rows.map((k) => k.l));
  const span = hi - lo || hi * 0.001 || 1;
  const y = (v: number) => padT + ((hi - v) / span) * (H - padT - padB);
  const slot = W / rows.length;
  const bw = Math.max(2, slot * 0.6);

  return (
    <div className="px-1 pb-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="15 minute candles">
        {openLine ? (
          <line
            x1={0}
            x2={W}
            y1={y(openLine)}
            y2={y(openLine)}
            stroke="var(--gold)"
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.8}
          />
        ) : null}
        {rows.map((k, i) => {
          const cx = i * slot + slot / 2;
          const up = k.c >= k.o;
          const color = up ? "var(--yes)" : "var(--no)";
          const top = y(Math.max(k.o, k.c));
          const bot = y(Math.min(k.o, k.c));
          const last = i === rows.length - 1;
          return (
            <g key={k.t} opacity={last ? 1 : 0.85}>
              <line x1={cx} x2={cx} y1={y(k.h)} y2={y(k.l)} stroke={color} strokeWidth={1} />
              <rect
                x={cx - bw / 2}
                y={top}
                width={bw}
                height={Math.max(1, bot - top)}
                fill={color}
                stroke={last ? "var(--hi)" : "none"}
                strokeWidth={last ? 1 : 0}
              />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between px-1 text-[8px] tabular-nums text-dim">
        <span>low {fmtPrice(lo)}</span>
        <span>high {fmtPrice(hi)}</span>
      </div>
    </div>
  );
}
