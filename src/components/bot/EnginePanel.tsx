import { mmss } from "@/lib/bot/candle";
import { CLOSE_SECS, GATE_SECS, SCORE_DIAL_MAX, type GatePresetName } from "@/lib/bot/constants";
import type { CandleInfo } from "@/lib/bot/candle";

export interface Gates {
  threshold: number;
  evMargin: number;
  minYesMid: number;
  maxYesMid: number;
  minSkew: number;
  maxSpread: number;
  minSigmaDist: number;
}

interface Props {
  candle: CandleInfo;
  botOn: boolean;
  onToggle: () => void;
  betSize: number;
  onBetSize: (n: number) => void;
  maxTrades: number;
  onMaxTrades: (n: number) => void;
  placedCount: number;
  exposure: number;
  lastTrade: { label: string; time: string } | null;
  tradedThisCandle: boolean;
  live: { configured: boolean; balance: number | null; error: string | null };
  evMargin: number;
  onEvMargin: (n: number) => void;
  gates: Gates;
  gatePreset: string;
  onGatePreset: (name: GatePresetName) => void;
  onGate: (patch: Partial<Gates>) => void;
  blocks?: { pair: string; reason: string }[];
  dayPnl: number;
  dailyLossCap: number;
  capHit: boolean;
  onResetDay: () => void;
}

export function EnginePanel({
  candle,
  botOn,
  onToggle,
  betSize,
  onBetSize,
  maxTrades,
  onMaxTrades,
  placedCount,
  exposure,
  lastTrade,
  tradedThisCandle,
  live,
  evMargin,
  onEvMargin,
  gates,
  gatePreset,
  onGatePreset,
  onGate,
  blocks,
  dayPnl,
  dailyLossCap,
  capHit,
  onResetDay,
}: Props) {
  const el = candle.elapsed;
  const gate = tradedThisCandle
    ? {
        text: `✅ ${maxTrades} trades placed this candle — waiting for the next one`,
        tone: "border-yes/40 bg-yes/10 text-yes",
      }
    : el < GATE_SECS
      ? {
          text: `🔒 Locked — trade window opens at the 10:00 mark (${mmss(GATE_SECS - el)})`,
          tone: "border-wire bg-surface-2 text-muted-foreground",
        }
      : el >= CLOSE_SECS
        ? { text: "🔴 Closing zone — too late for a new entry", tone: "border-no/30 bg-no/10 text-no" }
        : {
            text: `🟢 Trade window OPEN — the bot fires the best ${maxTrades} signals at ${gates.threshold}%+`,
            tone: "border-yes/40 bg-yes/10 text-yes",
          };

  const cells = [
    { label: "BET SIZE", value: `$${betSize}`, sub: "per trade", tone: "text-hi" },
    {
      label: "THIS CANDLE",
      value: lastTrade?.label ?? "—",
      sub: lastTrade?.time ?? "waiting",
      tone: "text-hi",
    },
    { label: "PLACED", value: String(placedCount), sub: "trades", tone: "text-hi" },
    { label: "EXPOSURE", value: `$${exposure}`, sub: "open", tone: "text-gold" },
  ];

  return (
    <section className="panel">
      <div className="panel-head">
        <span>Live Auto-Trade Engine</span>
        <span className="text-[8px] tracking-widest text-dim">
          {live.balance !== null ? `BALANCE $${live.balance.toFixed(2)}` : "LIVE"}
        </span>
      </div>

      <div className="p-3">
        <div
          className={`flex items-center justify-between rounded-md border px-3 py-2.5 ${
            botOn ? "border-no/60 bg-no/10" : "border-wire bg-surface-2"
          }`}
        >
          <span
            className={`font-sans text-[11px] font-bold tracking-[0.2em] ${botOn ? "text-no" : "text-muted-foreground"}`}
          >
            LIVE TRADING
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={botOn}
              aria-label="Toggle live trading"
              onClick={onToggle}
              className={`relative h-5 w-10 rounded-full border transition-colors ${
                botOn ? "border-no bg-no/30" : "border-wire bg-surface-3"
              }`}
            >
              <span
                className={`absolute top-0.5 size-3.5 rounded-full transition-all ${
                  botOn ? "left-[22px] bg-no" : "left-0.5 bg-dim"
                }`}
              />
            </button>
            <span
              className={`font-sans text-[11px] font-bold tracking-widest ${botOn ? "text-no" : "text-dim"}`}
            >
              {botOn ? "ON" : "OFF"}
            </span>
          </div>
        </div>
        <p className={`mt-1.5 text-[8px] leading-relaxed ${botOn ? "text-no" : "text-dim"}`}>
          {botOn
            ? "REAL MONEY ARMED — the server submits real Kalshi orders right away, even with this app closed. There is no paper mode."
            : !live.configured
              ? "Add your Kalshi API key on the server before switching this on."
              : "Off — no orders are placed. Switching on arms real money immediately."}
        </p>


        <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-wire bg-wire">
          {cells.map((c) => (
            <div key={c.label} className="bg-surface-2 p-2">
              <div className="text-[7px] tracking-[0.2em] text-dim">{c.label}</div>
              <div className={`font-sans text-[14px] font-extrabold ${c.tone}`}>{c.value}</div>
              <div className="text-[8px] text-muted-foreground">{c.sub}</div>
            </div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[5, 10, 15, 25].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onBetSize(n)}
              className={`rounded-md border py-1.5 text-[11px] transition-colors ${
                betSize === n
                  ? "border-yes/60 bg-yes/10 font-bold text-yes"
                  : "border-wire text-muted-foreground hover:border-dim"
              }`}
            >
              ${n}
            </button>
          ))}
        </div>

        <div className="mt-2">
          <div className="mb-1 text-[7px] tracking-[0.2em] text-dim">MAX TRADES / CANDLE</div>
          <div className="grid grid-cols-3 gap-1.5">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onMaxTrades(n)}
                className={`rounded-md border py-1.5 text-[11px] transition-colors ${
                  maxTrades === n
                    ? "border-yes/60 bg-yes/10 font-bold text-yes"
                    : "border-wire text-muted-foreground hover:border-dim"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 rounded-md border border-wire bg-surface-2 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[8px] tracking-[0.2em] text-muted-foreground">
              MIN VALUE PER $1 RISKED
            </span>
            <span className="font-sans text-[12px] font-extrabold text-gold tabular-nums">
              +{(evMargin * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={40}
            step={2}
            value={Math.round(evMargin * 100)}
            aria-label="Minimum expected value per dollar risked"
            onChange={(e) => onEvMargin(Number(e.target.value) / 100)}
            className="mt-2 w-full accent-[var(--gold)]"
          />
          <p className="mt-1 text-[8px] leading-relaxed text-dim">
            Higher = fewer, better-priced trades. Blocks expensive contracts with little left to win.
          </p>
        </div>

        {/* Every filter that can stop a trade, tunable, plus what is blocking now. */}
        <div className="mt-2 rounded-md border border-wire bg-surface-2 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[8px] tracking-[0.2em] text-muted-foreground">SIGNAL GATES</span>
            <span className="font-sans text-[9px] font-bold tracking-widest text-gold">
              {gatePreset.toUpperCase()}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {(["strict", "balanced", "aggressive"] as GatePresetName[]).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onGatePreset(n)}
                className={`rounded-md border py-1.5 text-[9px] tracking-widest transition-colors ${
                  gatePreset === n
                    ? "border-yes/60 bg-yes/10 font-bold text-yes"
                    : "border-wire text-muted-foreground hover:border-dim"
                }`}
              >
                {n.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="mt-2 space-y-2">
            {[
              {
                key: "threshold" as const,
                label: "MIN CONFIDENCE",
                value: gates.threshold,
                display: `${gates.threshold.toFixed(0)}%`,
                min: 60,
                max: SCORE_DIAL_MAX,
                step: 1,
                toValue: (v: number) => v,
              },

              {
                key: "maxSpread" as const,
                label: "MAX SPREAD",
                value: Math.round(gates.maxSpread * 100),
                display: `${(gates.maxSpread * 100).toFixed(0)}¢`,
                min: 2,
                max: 15,
                step: 1,
                toValue: (v: number) => v / 100,
              },
              {
                key: "minSkew" as const,
                label: "MIN BOOK LEAN",
                value: Math.round(gates.minSkew * 100),
                display: `${(gates.minSkew * 100).toFixed(0)}¢`,
                min: 0,
                max: 10,
                step: 1,
                toValue: (v: number) => v / 100,
              },
              {
                key: "minYesMid" as const,
                label: "PRICE BAND — LOW",
                value: Math.round(gates.minYesMid * 100),
                display: `${(gates.minYesMid * 100).toFixed(0)}¢`,
                min: 1,
                max: 40,
                step: 1,
                toValue: (v: number) => v / 100,
              },
              {
                key: "maxYesMid" as const,
                label: "PRICE BAND — HIGH",
                value: Math.round(gates.maxYesMid * 100),
                display: `${(gates.maxYesMid * 100).toFixed(0)}¢`,
                min: 60,
                max: 99,
                step: 1,
                toValue: (v: number) => v / 100,
              },
              {
                key: "minSigmaDist" as const,
                label: "STRIKE CUSHION",
                value: Math.round(gates.minSigmaDist * 100),
                display: `${gates.minSigmaDist.toFixed(2)}σ`,
                min: 0,
                max: 150,
                step: 5,
                toValue: (v: number) => v / 100,
              },
            ].map((g) => (
              <div key={g.key}>
                <div className="flex items-center justify-between">
                  <span className="text-[8px] tracking-[0.15em] text-dim">{g.label}</span>
                  <span className="font-sans text-[11px] font-extrabold text-hi tabular-nums">
                    {g.display}
                  </span>
                </div>
                <input
                  type="range"
                  min={g.min}
                  max={g.max}
                  step={g.step}
                  value={g.value}
                  aria-label={g.label}
                  onChange={(e) => onGate({ [g.key]: g.toValue(Number(e.target.value)) })}
                  className="mt-1 w-full accent-[var(--gold)]"
                />
              </div>
            ))}
          </div>

          {blocks?.length ? (
            <div className="mt-2 space-y-0.5 border-t border-wire pt-2">
              <p className="text-[8px] font-bold tracking-widest text-dim">BLOCKING RIGHT NOW</p>
              {blocks.slice(0, 7).map((b) => (
                <p key={b.pair} className="flex justify-between gap-2 text-[8px] text-dim">
                  <span className="font-bold text-fg">{b.pair}</span>
                  <span className="truncate text-right">{b.reason}</span>
                </p>
              ))}
            </div>
          ) : null}
        </div>






        <div
          className={`mt-2 rounded-md border px-3 py-2 ${
            capHit ? "border-no/50 bg-no/10" : "border-wire bg-surface-2"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[8px] tracking-[0.2em] text-muted-foreground">TODAY / CAP</span>
            <span
              className={`font-sans text-[12px] font-extrabold tabular-nums ${
                dayPnl < 0 ? "text-no" : "text-yes"
              }`}
            >
              {dayPnl < 0 ? "-" : "+"}${Math.abs(dayPnl).toFixed(2)} / -${dailyLossCap}
            </span>
          </div>
          {capHit ? (
            <button
              type="button"
              onClick={onResetDay}
              className="mt-2 w-full rounded-md border border-no/60 bg-no/20 py-1.5 font-sans text-[10px] font-bold tracking-widest text-no"
            >
              RESET DAY — RESUME TRADING
            </button>
          ) : (
            <p className="mt-1 text-[8px] leading-relaxed text-dim">
              Auto-trading stops for the day once today&apos;s loss reaches the cap.
            </p>
          )}
        </div>

        <div className={`mt-2 rounded-md border px-3 py-2 text-[10px] ${gate.tone}`}>{gate.text}</div>


        {live.error ? (
          <div className="mt-2 rounded-md border border-no/30 bg-no/10 px-3 py-2 text-[9px] text-no">
            {live.error}
          </div>
        ) : null}
      </div>
    </section>
  );
}