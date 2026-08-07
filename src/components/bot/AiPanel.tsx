import type { AiState } from "@/hooks/useBot";

interface Props {
  ai: AiState;
  aiAssist: boolean;
  onToggleAssist: (on: boolean) => void;
  onAsk: () => void;
  hasSignal: boolean;
}

export function AiPanel({ ai, aiAssist, onToggleAssist, onAsk, hasSignal }: Props) {
  const v = ai.verdict;
  const accent =
    ai.status === "error"
      ? "var(--no)"
      : v?.verdict === "take"
        ? "var(--yes)"
        : v?.verdict === "skip"
          ? "var(--gold)"
          : "var(--dim)";

  return (
    <section className="panel">
      <div className="panel-head">
        <span>AI Co-Pilot</span>
        <span className="text-[8px] tracking-widest text-dim">
          {aiAssist ? "GATING TRADES" : "ADVISORY ONLY"}
        </span>
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between rounded-md border border-wire bg-surface-2 px-3 py-2.5">
          <div>
            <div className="text-[8px] tracking-[0.2em] text-muted-foreground">
              REVIEW BEFORE EVERY TRADE
            </div>
            <p className="mt-0.5 text-[8px] leading-relaxed text-dim">
              The AI must approve a signal before the bot fires.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aiAssist}
            aria-label="Toggle AI trade review"
            onClick={() => onToggleAssist(!aiAssist)}
            className={`relative h-5 w-10 shrink-0 rounded-full border transition-colors ${
              aiAssist ? "border-gold bg-gold/25" : "border-wire bg-surface-3"
            }`}
          >
            <span
              className={`absolute top-0.5 size-3.5 rounded-full transition-all ${
                aiAssist ? "left-[22px] bg-gold" : "left-0.5 bg-dim"
              }`}
            />
          </button>
        </div>

        <button
          type="button"
          onClick={onAsk}
          disabled={ai.status === "thinking" || !hasSignal}
          className="mt-2 w-full rounded-md border border-gold/50 bg-gold/10 py-2 font-sans text-[11px] font-bold tracking-widest text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:border-wire disabled:bg-surface-2 disabled:text-dim"
        >
          {ai.status === "thinking"
            ? "ANALYSING…"
            : hasSignal
              ? "ASK AI ABOUT THE TOP SIGNAL"
              : "WAITING FOR A SIGNAL"}
        </button>

        <div
          className="mt-2 rounded-md border bg-surface-2 p-2.5"
          style={{ borderColor: `color-mix(in oklab, ${accent} 45%, transparent)` }}
        >
          {ai.status === "idle" ? (
            <p className="text-[9px] leading-relaxed text-muted-foreground">
              No review yet this candle. The AI weighs spread, BRTI momentum, strike distance and
              time left, then approves or vetoes the trade.
            </p>
          ) : ai.status === "thinking" ? (
            <p className="animate-blink text-[9px] tracking-widest text-gold">
              REVIEWING {ai.signalLabel ?? "SIGNAL"}…
            </p>
          ) : ai.status === "error" ? (
            <p className="text-[9px] leading-relaxed text-no">{ai.error}</p>
          ) : v ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span
                  className="rounded px-1.5 py-px font-sans text-[10px] font-extrabold tracking-widest"
                  style={{
                    background: `color-mix(in oklab, ${accent} 18%, transparent)`,
                    color: accent,
                  }}
                >
                  {v.verdict === "take" ? "✓ TAKE" : "✕ SKIP"}
                </span>
                <span className="text-[8px] tracking-widest text-dim">
                  {ai.signalLabel} · {ai.at}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full" style={{ width: `${v.confidence}%`, background: accent }} />
              </div>
              <div className="mt-1 text-[8px] tracking-widest text-dim">
                AI CONVICTION <b className="text-foreground">{v.confidence.toFixed(0)}%</b>
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-foreground">{v.rationale}</p>
              {v.risk ? (
                <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
                  ⚠ {v.risk}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
