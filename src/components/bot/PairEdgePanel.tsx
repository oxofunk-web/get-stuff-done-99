import { PAIRS } from "@/lib/bot/constants";
import type { AccuracyStats } from "@/lib/bot/telemetry.functions";

/** Below this many settled samples a pair is still "learning", not judged. */
const MIN_JUDGE = 12;

interface Props {
  accuracy: AccuracyStats | null;
  betSize: number;
}

function money(n: number) {
  const s = Math.abs(n).toFixed(2);
  return `${n < 0 ? "-" : ""}$${s}`;
}

/**
 * Per-pair economics. Risk is what the bet actually puts at stake, breakeven is
 * the win rate the entry price demands, and edge is your measured rate minus
 * that. The same numbers now feed the engine's probability, so a pair with a
 * negative edge has to be cheaper before it clears the EV gate.
 */
export function PairEdgePanel({ accuracy, betSize }: Props) {
  const rows = PAIRS.map((p) => {
    const e = accuracy?.pairEdge.find((r) => r.pair === p.id);
    // Compare like with like: the win rate of trades actually fired against the
    // breakeven of the prices those trades paid.
    const n = e?.fired ?? 0;
    const winRate = n ? ((e?.firedWins ?? 0) / n) * 100 : 0;
    const graded = e?.n ?? 0;
    const avgEntry = e?.avgEntry ?? 0;
    const breakeven = avgEntry > 0 ? avgEntry * 100 : 0;
    // Contracts the bet buys at the pair's typical entry, and the dollars lost
    // if it settles the wrong way — that's the true risk per trade.
    const contracts = avgEntry > 0 ? Math.max(1, Math.floor(betSize / avgEntry)) : 0;
    const risk = contracts * avgEntry;
    const judged = n >= MIN_JUDGE && avgEntry > 0;
    return {
      pair: p.id,
      n,
      graded,
      winRate,
      breakeven,
      risk,
      contracts,
      pnl: e?.pnl ?? 0,
      trades: e?.trades ?? 0,
      edge: judged ? winRate - breakeven : 0,
      judged,
    };
  }).sort((a, b) => Number(b.judged) - Number(a.judged) || b.edge - a.edge);

  return (
    <section className="panel">
      <div className="panel-head">
        <span>Pair Edge — Risk, Breakeven & Real Win Rate</span>
        <span className="text-[7px] tracking-widest text-dim">${betSize.toFixed(0)}/TRADE</span>
      </div>

      <div className="p-2.5">
        <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr] items-center gap-x-2 gap-y-1 text-[8px]">
          <div className="tracking-[0.16em] text-dim">PAIR</div>
          <div className="text-right tracking-[0.16em] text-dim">RISK/TRADE</div>
          <div className="text-right tracking-[0.16em] text-dim">NEEDS</div>
          <div className="text-right tracking-[0.16em] text-dim">ACTUAL</div>
          <div className="text-right tracking-[0.16em] text-dim">P&amp;L</div>

          {rows.map((r) => {
            const good = r.judged && r.edge > 0;
            const tone = !r.judged ? "text-gold" : good ? "text-yes" : "text-no";
            return (
              <div key={r.pair} className="col-span-5 grid grid-cols-[auto_1fr_1fr_1fr_1fr] items-baseline gap-x-2 border-t border-wire/60 py-1">
                <div className="w-12 text-[10px] font-semibold text-foreground">{r.pair}</div>
                <div className="text-right text-[10px] tabular-nums text-muted-foreground">
                  {r.risk > 0 ? money(r.risk) : "—"}
                  {r.contracts ? (
                    <span className="ml-1 text-[8px] text-dim">×{r.contracts}</span>
                  ) : null}
                </div>
                <div className="text-right text-[10px] tabular-nums text-muted-foreground">
                  {r.breakeven > 0 ? `${r.breakeven.toFixed(0)}%` : "—"}
                </div>
                <div className={`text-right text-[10px] font-semibold tabular-nums ${tone}`}>
                  {r.n ? `${r.winRate.toFixed(0)}%` : "—"}
                  <span className="ml-1 text-[8px] text-dim">{r.n ? `n${r.n}` : "no data"}</span>
                </div>
                <div
                  className={`text-right text-[10px] tabular-nums ${r.pnl > 0 ? "text-yes" : r.pnl < 0 ? "text-no" : "text-dim"}`}
                >
                  {r.trades ? money(r.pnl) : "—"}
                </div>
                <div className="col-span-5 -mt-0.5 text-[8px] text-dim">
                  {!r.judged
                    ? `learning — ${r.n} settled trades (needs ${Math.max(1, MIN_JUDGE - r.n)} more) · ${r.graded} graded samples already feeding the odds`
                    : `edge ${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(0)} pts vs. breakeven · ${r.graded} graded samples · engine weights ${r.pair} by this record`}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-2 rounded border border-wire bg-surface-2 p-2 text-[8px] leading-relaxed text-dim">
          RISK/TRADE is the dollars at stake if the contract settles wrong (contracts × entry).
          NEEDS is the win rate the average entry price implies. ACTUAL is your settled rate on that
          pair, including graded counterfactuals. The bot blends each pair&apos;s own rate into its
          probability — the more settled history a pair has, the more it counts.
        </div>
      </div>
    </section>
  );
}
