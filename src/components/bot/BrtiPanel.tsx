import { fmtPrice } from "@/lib/bot/candle";
import { PAIRS, type PairId } from "@/lib/bot/constants";
import { lagState } from "@/lib/bot/signals";
import type { KalshiMarket, SpotState } from "@/lib/bot/types";
import type { FeedSource, FeedStatus } from "@/hooks/useBrtiFeed";

const lagCopy = { fire: "⚡ LAG", warn: "DRIFT", ok: "IN SYNC" } as const;
const lagTone = {
  fire: "text-gold border-gold/40 bg-gold/10",
  warn: "text-blue border-blue/30 bg-blue/10",
  ok: "text-dim border-wire",
} as const;

interface Props {
  spot: Partial<Record<PairId, SpotState>>;
  markets: Partial<Record<PairId, KalshiMarket>>;
  history: Partial<Record<PairId, number[]>>;
  status: FeedStatus;
  source: FeedSource;
}

const sourceCopy: Record<FeedSource, string> = {
  coinbase: "COINBASE LIVE",
  binance: "BINANCE LIVE",
  server: "SERVER RELAY",
};

export function BrtiPanel({ spot, markets, history, status, source }: Props) {
  const latestTick = Math.max(0, ...Object.values(spot).map((value) => value?.ts ?? 0));
  const ageSeconds = latestTick ? Math.max(0, Math.floor((Date.now() - latestTick) / 1000)) : null;
  return (
    <section className="panel">
      <div className="panel-head">
        <span>BRTI Real-Time Spot</span>
        <span className="flex items-center gap-1.5 text-[8px] tracking-widest">
          <span
            className={`size-1.5 rounded-full ${
              status === "live" ? "bg-yes animate-blink" : status === "connecting" ? "bg-gold" : "bg-no"
            }`}
          />
          <span
            className={status === "live" ? "text-yes" : status === "connecting" ? "text-gold" : "text-no"}
          >
            {status === "live"
              ? `${sourceCopy[source]} · ${ageSeconds ?? "—"}s`
              : status === "connecting"
                ? "CONNECTING"
                : "RECONNECTING"}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-wire">
        {PAIRS.map((p) => {
          const s = spot[p.id];
          const lag = lagState(s, markets[p.id], history[p.id]);
          const ch = s?.change24h ?? 0;
          const up = s ? s.price >= s.prev : true;
          return (
            <div key={p.id} className="bg-surface-2 p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full" style={{ background: p.colorVar }} />
                <span className={`font-sans text-[11px] font-bold ${p.colorClass}`}>{p.id}</span>
                <span className="text-[7px] tracking-widest text-dim">{p.name.toUpperCase()}</span>
              </div>
              <div
                className={`mt-1 font-sans text-[15px] font-extrabold tabular-nums transition-colors ${
                  up ? "text-yes" : "text-no"
                }`}
              >
                {fmtPrice(s?.price)}
              </div>
              <div className="mt-0.5 flex items-center justify-between">
                <span className={`text-[9px] ${ch >= 0 ? "text-yes" : "text-no"}`}>
                  {ch >= 0 ? "+" : ""}
                  {ch.toFixed(2)}% 24h
                </span>
                <span
                  className={`rounded-full border px-1.5 py-px text-[7px] tracking-widest ${lagTone[lag]}`}
                >
                  {lagCopy[lag]}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}