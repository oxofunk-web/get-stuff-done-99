import { CLOSE_SECS, GATE_SECS } from "./constants";

export interface CandleInfo {
  elapsed: number;
  remain: number;
  pct: number;
  id: number;
}

export function candleInfo(now = Date.now()): CandleInfo {
  const total = 900;
  const elapsed = Math.floor((now / 1000) % total);
  return {
    elapsed,
    remain: total - elapsed,
    pct: elapsed / total,
    id: Math.floor(now / 1000 / total),
  };
}

export type Phase = "warmup" | "approach" | "trade" | "closing";

export function phaseOf(elapsed: number): Phase {
  if (elapsed < 360) return "warmup";
  if (elapsed < GATE_SECS) return "approach";
  if (elapsed < CLOSE_SECS) return "trade";
  return "closing";
}

export function mmss(s: number) {
  const m = Math.floor(Math.max(0, s) / 60);
  const sec = Math.floor(Math.max(0, s) % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function fmtPrice(n: number | undefined | null) {
  if (!n) return "—";
  if (n < 1) return `$${n.toFixed(5)}`;
  if (n < 10) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}