import { it } from "vitest";
import { computeSignals, getSignalTrace } from "@/lib/bot/signals";
import { setTuning, resetTuning } from "@/lib/bot/tuning";
import { GATE_SECS } from "@/lib/bot/constants";
const inWindow = Math.floor(Date.now() / 900_000) * 900_000 + (GATE_SECS + 60) * 1_000;
function tape(base: number, drift: number, ticks = 60, at = 0) {
  const start = at - ticks * 1_000;
  const rows = Array.from({ length: ticks }, (_, i) => ({ price: base * (1 + drift * i), ts: start + i * 1_000 }));
  const last = rows[rows.length - 1]!;
  return { price: last.price, prev: rows[rows.length - 2]!.price, change24h: 0, ts: last.ts, ticks: rows };
}
it("dbg", () => {
  resetTuning();
  setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1, maxSigmaDist: 50 });
  computeSignals({ BTC: tape(101, 0.000002, 60, inWindow) } as never, { BTC: { pair: "BTC", ticker: "T", strike: 100, strikeType: "floor", yesBid: 0.52, yesAsk: 0.54, noBid: 0.46, noAsk: 0.48, yesMid: 0.53, spread: 0.02, vol: 1, yesAskSize: 50, yesBidSize: 50, closeTime: null } } as never, { BTC: [0.52, 0.53] } as never, inWindow);
  console.log(JSON.stringify(getSignalTrace().filter((t) => t.pair === "BTC"), null, 1));
});
