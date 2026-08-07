import { PAIRS } from "@/lib/bot/constants";
import type { Mode, OpenPosition, Portfolio } from "@/hooks/useBot";

interface Props {
  mode: Mode;
  portfolio: Portfolio;
  balance: number | null;
  realized: number;
  unrealized: number;
  open: OpenPosition[];
  wins: number;
  losses: number;
  onRefresh: () => void;
}

function money(n: number) {
  return `${n < 0 ? "-" : "+"}$${Math.abs(n).toFixed(2)}`;
}

function tone(n: number) {
  return n > 0 ? "text-yes" : n < 0 ? "text-no" : "text-hi";
}

export function PnlPanel({
  mode,
  portfolio,
  balance,
  realized,
  unrealized,
  open,
  wins,
  losses,
  onRefresh,
}: Props) {
  const total = realized + unrealized;
  const settled = wins + losses;
  const winRate = settled ? (wins / settled) * 100 : null;

  return (
    <section className="panel">
      <div className="panel-head">
        <span>Wallet &amp; P&amp;L</span>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded border border-wire px-1.5 py-px text-[7px] tracking-widest text-dim hover:border-dim hover:text-muted-foreground"
        >
          REFRESH
        </button>
      </div>

      <div className="p-3">
        <div className="rounded-md border border-wire bg-surface-2 px-3 py-2.5">
          <div className="text-[7px] tracking-[0.25em] text-dim">KALSHI WALLET BALANCE</div>
          <div className="font-sans text-[24px] font-extrabold leading-tight text-hi tabular-nums">
            {balance !== null ? `$${balance.toFixed(2)}` : portfolio.configured ? "—" : "NOT LINKED"}
          </div>
          <div className="text-[8px] text-muted-foreground">
            {portfolio.error
              ? portfolio.error
              : portfolio.configured
                ? `${portfolio.positions.length} live position${portfolio.positions.length === 1 ? "" : "s"} · live exposure $${portfolio.exposure.toFixed(2)}`
                : "Add your Kalshi API key to see your real balance."}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-wire bg-wire">
          {[
            { label: "REALIZED", value: money(realized), t: tone(realized), sub: mode === "live" ? "kalshi" : "paper" },
            { label: "OPEN P&L", value: money(unrealized), t: tone(unrealized), sub: "mark-to-market" },
            { label: "NET", value: money(total), t: tone(total), sub: "session" },
          ].map((c) => (
            <div key={c.label} className="bg-surface-2 p-2">
              <div className="text-[7px] tracking-[0.2em] text-dim">{c.label}</div>
              <div className={`font-sans text-[13px] font-extrabold tabular-nums ${c.t}`}>{c.value}</div>
              <div className="text-[8px] text-muted-foreground">{c.sub}</div>
            </div>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between rounded-md border border-wire bg-surface-2 px-3 py-2 text-[9px] tracking-widest text-muted-foreground">
          <span>
            SETTLED <b className="text-foreground">{settled}</b>
          </span>
          <span>
            W/L{" "}
            <b className="text-yes">{wins}</b>
            <span className="text-dim">/</span>
            <b className="text-no">{losses}</b>
          </span>
          <span>
            WIN RATE{" "}
            <b className="text-foreground">{winRate !== null ? `${winRate.toFixed(0)}%` : "—"}</b>
          </span>
        </div>

        <div className="mt-2 space-y-1">
          <div className="text-[7px] tracking-[0.25em] text-dim">OPEN POSITIONS</div>
          {open.length === 0 ? (
            <p className="rounded-md border border-wire bg-surface-2 px-3 py-2 text-[9px] text-muted-foreground">
              No open contracts this candle.
            </p>
          ) : (
            open.map((p) => {
              const pair = PAIRS.find((x) => x.id === p.pair);
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-md border border-wire bg-surface-2 px-2.5 py-1.5 text-[9px]"
                >
                  <span className="flex items-center gap-1.5">
                    <b className={`font-sans text-[11px] font-extrabold ${pair?.colorClass ?? "text-hi"}`}>
                      {p.pair}
                    </b>
                    <span className={p.dir === "YES" ? "text-yes" : "text-no"}>{p.dir}</span>
                    <span className="text-dim">×{p.count}</span>
                    {p.paper ? (
                      <span className="rounded border border-wire px-1 text-[7px] tracking-widest text-dim">
                        PAPER
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    @ {(p.entry * 100).toFixed(0)}¢ · ${p.stake.toFixed(2)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
