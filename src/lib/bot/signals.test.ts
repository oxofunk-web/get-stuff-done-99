import { describe, expect, it } from "vitest";

import { computeSignals } from "./signals";
import { getTuning, resetTuning, setTuning } from "./tuning";
import { GATE_SECS, MAX_ENTRY_PRICE, SCORE_CAP_UNPROVEN } from "./constants";
import type { KalshiMarket, SpotState } from "./types";

/** Deterministic upward tape inside the trade window. */
function tape(base: number, drift: number, ticks = 60, at = 0): SpotState {
  const start = at - ticks * 1_000;
  const rows = Array.from({ length: ticks }, (_, i) => ({
    price: base * (1 + drift * i),
    ts: start + i * 1_000,
  }));
  const last = rows[rows.length - 1]!;
  return { price: last.price, prev: rows[rows.length - 2]!.price, change24h: 0, ts: last.ts, ticks: rows };
}

function market(over: Partial<KalshiMarket> = {}): KalshiMarket {
  return {
    pair: "BTC",
    ticker: "KXBTC15M-T",
    strike: 100,
    strikeType: "floor",
    yesBid: 0.6,
    yesAsk: 0.62,
    noBid: 0.38,
    noAsk: 0.4,
    yesMid: 0.61,
    spread: 0.02,
    vol: 500,
    yesAskSize: 50,
    yesBidSize: 50,
    closeTime: null,
    ...over,
  };
}

/** A timestamp comfortably inside the trade window of a 15-minute candle. */
const inWindow = Math.floor(Date.now() / 900_000) * 900_000 + (GATE_SECS + 60) * 1_000;

describe("signal scoring", () => {
  it("spreads scores instead of pinning them at the ceiling", () => {
    resetTuning();
    setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1, maxSigmaDist: 50 });
    const weak = computeSignals(
      { BTC: tape(101, 0.000002, 60, inWindow) },
      { BTC: market({ yesMid: 0.53, yesBid: 0.52, yesAsk: 0.54 }) },
      { BTC: [0.52, 0.53] },
      inWindow,
    );
    const strong = computeSignals(
      { BTC: tape(101, 0.00004, 60, inWindow) },
      { BTC: market() },
      { BTC: [0.5, 0.52, 0.55, 0.58, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67] },
      inWindow,
    );
    expect(weak.length).toBe(1);
    expect(strong.length).toBe(1);
    expect(strong[0]!.conf).toBeGreaterThan(weak[0]!.conf + 3);
    expect(strong[0]!.conf).toBeLessThanOrEqual(SCORE_CAP_UNPROVEN);
    resetTuning();
  });

  it("refuses a leg that costs more than the price ceiling", () => {
    resetTuning();
    setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1 });
    const pricey = MAX_ENTRY_PRICE + 0.1;
    const out = computeSignals(
      { BTC: tape(101, 0.00004, 60, inWindow) },
      { BTC: market({ yesBid: pricey - 0.01, yesAsk: pricey, yesMid: pricey - 0.005 }) },
      { BTC: [0.7, 0.75] },
      inWindow,
    );
    expect(out.length).toBe(0);
    resetTuning();
  });

  it("skips a book with nothing resting in it", () => {
    resetTuning();
    setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1 });
    const out = computeSignals(
      { BTC: tape(101, 0.00004, 60, inWindow) },
      { BTC: market({ yesAskSize: 0, yesBidSize: 0 }) },
      { BTC: [0.6, 0.61] },
      inWindow,
    );
    expect(out.length).toBe(0);
    resetTuning();
  });

  it("keeps a cushion band with an upper edge", () => {
    expect(getTuning().maxSigmaDist).toBeGreaterThan(getTuning().minSigmaDist);
  });
});
