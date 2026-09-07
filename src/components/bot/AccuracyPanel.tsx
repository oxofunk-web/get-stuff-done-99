import { bandLabel, MIN_SAMPLES } from "@/lib/bot/calibration";
import type { AccuracyStats, RejectionRow } from "@/lib/bot/telemetry.functions";

interface Props {
  accuracy: AccuracyStats | null;
  rejections: RejectionRow[];
  onRefresh: () => void;
}

function rate(wins: number, n: number) {
  return n ? (wins / n) * 100 : 0;
}

function toneFor(pct: number, n: number) {
  if (!n) return "text-dim";
  if (pct >= 60) return "text-yes";
  if (pct >= 50) return "text-gold";
  return "text-no";
}

export function AccuracyPanel({ accuracy, rejections, onRefresh }: Props) {
  const a = accuracy;
  const has = Boolean(a?.ok && (a.total > 0 || a.monitorTotal > 0 || a.counterfactual > 0));


  return (
    <section className="panel">
      <div className="panel-head">
        <span>Real Accuracy — Settled History</span>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded border border-wire px-1.5 py-px text-[7px] tracking-widest text-dim hover:border-dim hover:text-muted-foreground"
        >
          REFRESH
        </button>
      </div>

      <div className="p-2.5">
        {!has ? (
          <div className="py-8 text-center">
            <div className="text-2xl">📊</div>
            <div className="mt-2 text-[11px] text-foreground">Still collecting outcomes</div>
            <div className="mt-1 text-[9px] leading-relaxed text-dim">
              Real fills, shadow signals, and rejected opportunities are tracked separately. Only
              settled real fills can calibrate money decisions.
            </div>
            {a?.error ? <div className="mt-2 text-[8px] text-no">{a.error}</div> : null}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-wire bg-wire">
              <div className="bg-surface-2 p-2">
                <div className="text-[7px] tracking-[0.2em] text-dim">LIVE FILLS</div>
                <div className="font-sans text-[15px] font-extrabold text-hi tabular-nums">
                  {a!.total}
                </div>
                <div className="text-[8px] text-muted-foreground">server trades</div>
              </div>
              <div className="bg-surface-2 p-2">
                <div className="text-[7px] tracking-[0.2em] text-dim">WIN RATE</div>
                <div
                  className={`font-sans text-[15px] font-extrabold tabular-nums ${toneFor(a!.winRate, a!.total)}`}
                >
                  {a!.winRate.toFixed(1)}%
                </div>
                <div className="text-[8px] text-muted-foreground">{a!.wins} wins</div>
              </div>
              <div className="bg-surface-2 p-2">
                <div className="text-[7px] tracking-[0.2em] text-dim">PROVEN BANDS</div>
                <div className="font-sans text-[15px] font-extrabold text-gold tabular-nums">
                  {a!.table.filter((b) => b.n >= MIN_SAMPLES).length}/{a!.table.length}
                </div>
                <div className="text-[8px] text-muted-foreground">bands live</div>
              </div>
            </div>

            <div className="mt-2 rounded-md border border-wire bg-surface-2 p-2 text-[8px] text-muted-foreground">
              LEARNING FROM REAL RESULTS — {a!.learningFills} of {a!.learningNeeded} settled fills needed before
              confidence is trusted
              {a!.voidFills ? ` · ${a!.voidFills} fill(s) never resolved and are excluded` : ""}
            </div>

            {a!.monitorTotal ? (
              <div className="mt-2 rounded-md border border-gold/40 bg-gold/10 p-2 text-[8px] text-gold">
                MONITOR ONLY — {a!.monitorWins}/{a!.monitorTotal} directions right after de-duplication · hypothetical {a!.monitorNetPerDollar >= 0 ? "+" : ""}{(a!.monitorNetPerDollar * 100).toFixed(1)}¢ per $1 risked. These were not trades.
              </div>
            ) : null}

            <div className="mt-2.5 text-[7px] tracking-[0.2em] text-dim">
              REAL FILLS BY SCORE BAND · shadows excluded
            </div>

            <div className="mt-1 space-y-1">
              {a!.table.map((b) => {
                const pct = rate(b.wins, b.n);
                const live = b.n >= MIN_SAMPLES;
                return (
                  <div key={b.lo} className="flex items-center gap-2">
                    <span className="w-14 text-[9px] text-muted-foreground">
                      {bandLabel(b.lo, b.hi)}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.min(100, pct)}%`,
                          background: live
                            ? pct >= 50
                              ? "var(--yes)"
                              : "var(--no)"
                            : "var(--gold)",
                          opacity: live ? 1 : 0.45,
                        }}
                      />
                    </div>
                    <span className={`w-20 text-right text-[9px] tabular-nums ${toneFor(pct, b.n)}`}>
                      {b.n ? `${pct.toFixed(0)}% · ${b.n}` : "no data"}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[7px] tracking-[0.2em] text-dim">BY PAIR</div>
                <div className="mt-1 space-y-0.5">
                  {a!.byPair.map((p) => (
                    <div key={p.pair} className="flex justify-between text-[9px]">
                      <span className="text-muted-foreground">{p.pair}</span>
                      <span className={toneFor(rate(p.wins, p.n), p.n)}>
                        {rate(p.wins, p.n).toFixed(0)}% · {p.n}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[7px] tracking-[0.2em] text-dim">BY MINUTE IN CANDLE</div>
                <div className="mt-1 space-y-0.5">
                  {a!.byMinute.map((m) => (
                    <div key={m.minute} className="flex justify-between text-[9px]">
                      <span className="text-muted-foreground">{m.minute}:00</span>
                      <span className={toneFor(rate(m.wins, m.n), m.n)}>
                        {rate(m.wins, m.n).toFixed(0)}% · {m.n}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {a!.recent.length ? (
              <div className="mt-3">
                <div className="text-[7px] tracking-[0.2em] text-dim">LAST SETTLED</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {a!.recent.map((r, i) => (
                    <span
                      key={`${r.ts}-${i}`}
                      className={`rounded border px-1.5 py-px text-[8px] tracking-wider ${
                        r.outcome === "win"
                          ? "border-yes/40 bg-yes/10 text-yes"
                          : "border-no/40 bg-no/10 text-no"
                      }`}
                    >
                      {r.pair} {r.dir} {r.conf.toFixed(0)}%
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {(a!.discrimination ?? []).some((d) => d.firedN + d.rejectedN > 0) ? (
              <div className="mt-3">
                <div className="text-[7px] tracking-[0.2em] text-dim">
                  DOES A HIGHER SCORE WIN MORE? · taken vs skipped, by score band
                </div>
                <div className="mt-1 space-y-0.5">
                  {a!.discrimination
                    .filter((d) => d.firedN + d.rejectedN > 0)
                    .map((d) => (
                      <div key={`${d.lo}-${d.hi}`} className="flex items-baseline justify-between gap-2 text-[9px]">
                        <span className="text-muted-foreground">{bandLabel(d)}</span>
                        <span className="shrink-0 tabular-nums text-dim">
                          taken{" "}
                          <span className={toneFor(rate(d.firedWins, d.firedN), d.firedN)}>
                            {d.firedN ? `${rate(d.firedWins, d.firedN).toFixed(0)}% of ${d.firedN}` : "—"}
                          </span>{" "}
                          · skipped{" "}
                          <span className={toneFor(rate(d.rejectedWins, d.rejectedN), d.rejectedN)}>
                            {d.rejectedN
                              ? `${rate(d.rejectedWins, d.rejectedN).toFixed(0)}% of ${d.rejectedN}`
                              : "—"}
                          </span>
                        </span>
                      </div>
                    ))}
                </div>
                <p className="mt-1 text-[8px] leading-relaxed text-dim">
                  If every band shows the same win rate, the score is not telling the bot anything
                  yet and the dial cannot help.
                </p>
              </div>
            ) : null}

            {rejections.length ? (
              <div className="mt-3">
                <div className="text-[7px] tracking-[0.2em] text-dim">
                  WHAT THE FILTERS BLOCKED · win% is what those trades would have done
                </div>
                <div className="mt-1 space-y-0.5">
                  {rejections.slice(0, 8).map((r) => (
                    <div key={r.reason} className="flex items-baseline justify-between gap-2 text-[9px]">
                      <span className="truncate text-muted-foreground">{r.reason}</span>
                      <span className="shrink-0 tabular-nums text-dim">
                        {r.n}×{" "}
                        <span className={toneFor(r.winRate, r.settled)}>
                          {r.settled ? `${r.winRate.toFixed(0)}% of ${r.settled}` : "unsettled"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

          </>
        )}
      </div>
    </section>
  );
}
