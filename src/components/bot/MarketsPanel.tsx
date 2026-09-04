import { PAIRS, type PairId } from "@/lib/bot/constants";
import type { KalshiMarket } from "@/lib/bot/types";

interface Props {
  markets: Partial<Record<PairId, KalshiMarket>>;
  ok: boolean | null;
}

export function MarketsPanel({ markets, ok }: Props) {
  const rows = PAIRS.filter((p) => markets[p.id]);

  return (
    <section className="panel">
      <div className="panel-head">
        <span>Live Kalshi Markets</span>
        <span className="text-[8px] tracking-widest text-dim">YES / NO ORDERBOOK</span>
      </div>

      {rows.length === 0 ? (
        <div className="p-5 text-center text-[11px] text-dim">
          {ok === false ? "Kalshi feed unavailable — retrying…" : "Fetching orderbook…"}
        </div>
      ) : (
        <div className="divide-y divide-wire">
          {rows.map((p) => {
            const m = markets[p.id]!;
            const tone =
              m.spread < 0.02 ? "text-yes" : m.spread < 0.05 ? "text-gold" : "text-no";
            return (
              <div key={p.id} className="grid grid-cols-[1.4fr_1fr_auto_auto_auto] items-center gap-2 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full" style={{ background: p.colorVar }} />
                  <div className="min-w-0">
                    <div className={`font-sans text-[11px] font-bold ${p.colorClass}`}>{p.id}</div>
                    <div className="truncate text-[7px] text-dim">{m.ticker}</div>
                  </div>
                </div>
                <div>
                  {m.strike ? (
                    <>
                      <div className="text-[7px] tracking-widest text-dim">STRIKE</div>
                      <div className="text-[11px] tabular-nums">${Number(m.strike).toLocaleString()}</div>
                    </>
                  ) : (
                    <span className="text-[9px] text-dim">—</span>
                  )}
                </div>
                <div className="text-center">
                  <div className="text-[7px] tracking-widest text-dim">YES</div>
                  <div className="font-sans text-[13px] font-bold tabular-nums text-yes">
                    {(m.yesMid * 100).toFixed(0)}¢
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[7px] tracking-widest text-dim">NO</div>
                  <div className="font-sans text-[13px] font-bold tabular-nums text-no">
                    {((1 - m.yesMid) * 100).toFixed(0)}¢
                  </div>
                </div>
                <div className={`text-right text-[10px] tabular-nums ${tone}`}>
                  {(m.spread * 100).toFixed(1)}¢
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-wire px-3 py-1.5">
        <span
          className={`flex items-center gap-1 rounded-full border px-2 py-px text-[7px] tracking-widest ${
            ok === false
              ? "border-no/30 bg-no/10 text-no"
              : "border-yes/30 bg-yes/10 text-yes"
          }`}
        >
          <span className="size-1 rounded-full bg-current animate-blink" />
          {ok === false ? "KALSHI ERR — RETRYING" : "KALSHI LIVE · REAL ORDERS"}
        </span>
      </div>
    </section>
  );
}