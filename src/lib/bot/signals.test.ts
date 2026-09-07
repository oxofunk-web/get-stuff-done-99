import { describe, expect, it } from "vitest";

import { computeSignals, getSignalTrace, isMaterialMomentumReversal } from "./signals";
import { getTuning, resetTuning, setTuning } from "./tuning";
import { GATE_SECS, MAX_ENTRY_PRICE, SCORE_CAP_UNPROVEN } from "./constants";
import type { KalshiMarket, SpotState } from "./types";

/** Deterministic upward tape inside the trade window. */
function tape(base: number, drift: number, ticks = 60, at = 0): SpotState {
  const start = at - ticks * 1_000;
  const rows = Array.from({ length: ticks }, (_, i) => ({
    // deterministic jitter so return volatility is non-zero
    price: base * (1 + drift * i + (i % 2 === 0 ? 0.00015 : -0.00015)),
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
    yesBid: 0.54,
    yesAsk: 0.56,
    noBid: 0.44,
    noAsk: 0.46,
    yesMid: 0.55,
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

  it("refuses a leg that costs more than the absolute ceiling", () => {
    resetTuning();
    setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1 });
    const pricey = MAX_ENTRY_PRICE + 0.05;
    const out = computeSignals(
      { BTC: tape(101, 0.00004, 60, inWindow) },
      { BTC: market({ yesBid: pricey - 0.01, yesAsk: pricey, yesMid: pricey - 0.005 }) },
      { BTC: [0.7, 0.75] },
      inWindow,
    );
    expect(out.length).toBe(0);
    resetTuning();
  });

  it("allows an expensive leg when the value still clears the margin", () => {
    resetTuning();
    setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1, entryValueTestPrice: 0.99 });
    const out = computeSignals(
      { BTC: tape(101, 0.00004, 60, inWindow) },
      { BTC: market({ yesBid: 0.77, yesAsk: 0.79, yesMid: 0.78 }) },
      { BTC: [0.7, 0.75] },
      inWindow,
    );
    expect(out.length).toBe(1);
    expect(out[0]!.entry).toBeCloseTo(0.79, 5);
    resetTuning();
  });

  it("flips the direction when spot sits on the other side of the strike", () => {
    resetTuning();
    setTuning({ threshold: 0, evMargin: -1, entryValueTestPrice: 0.99 });
    // Falling tape below a floor strike: the YES lean is wrong, NO is right.
    const out = computeSignals(
      { BTC: tape(99, -0.00004, 60, inWindow) },
      { BTC: market({ strike: 100, yesMid: 0.45, yesBid: 0.44, yesAsk: 0.46, noAsk: 0.56 }) },
      { BTC: [0.5, 0.48, 0.46, 0.45] },
      inWindow,
    );
    const fired = getSignalTrace().filter((t) => t.verdict === "fired");
    expect(out.every((s) => s.dir === "NO")).toBe(true);
    expect(fired.every((t) => t.dir === "NO")).toBe(true);
    resetTuning();
  });

  it("lets a flat book through only when the cushion is strong", () => {
    resetTuning();
    setTuning({ threshold: 0, evMargin: -1, minSkew: 0.05, entryValueTestPrice: 0.99 });
    computeSignals(
      { BTC: tape(101, 0.00004, 60, inWindow) },
      { BTC: market({ yesMid: 0.52, yesBid: 0.51, yesAsk: 0.53 }) },
      { BTC: [0.5, 0.51, 0.52] },
      inWindow,
    );
    const flatNoEvidence = getSignalTrace().some((t) =>
      t.reason.includes("book too flat with no other evidence"),
    );
    setTuning({ strongCushion: 0 });
    computeSignals(
      { BTC: tape(101, 0.00004, 60, inWindow) },
      { BTC: market({ yesMid: 0.52, yesBid: 0.51, yesAsk: 0.53 }) },
      { BTC: [0.5, 0.51, 0.52] },
      inWindow,
    );
    const passedOnCushion = getSignalTrace().every(
      (t) => !t.reason.includes("book too flat with no other evidence"),
    );
    expect(flatNoEvidence).toBe(true);
    expect(passedOnCushion).toBe(true);
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

describe("momentum reversal filter", () => {
  it("does not block a tiny counter-move", () => {
    expect(isMaterialMomentumReversal("YES", -0.00059, -0.001)).toBe(false);
  });

  it("does not block a short dip when broader momentum still supports the signal", () => {
    expect(isMaterialMomentumReversal("YES", -0.0008, 0.0002)).toBe(false);
  });

  it("blocks a material reversal confirmed by both momentum windows", () => {
    expect(isMaterialMomentumReversal("YES", -0.0008, -0.0002)).toBe(true);
    expect(isMaterialMomentumReversal("NO", 0.0008, 0.0002)).toBe(true);
  });
});

describe("current-candle data requirement", () => {
  it("rejects a tape thinner than the required readings", () => {
    resetTuning();
    setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1, minTicks: 60 });
    const out = computeSignals(
      { BTC: tape(101, 0.00004, 40, inWindow) },
      { BTC: market() },
      { BTC: [0.6, 0.61] },
      inWindow,
    );
    expect(out.length).toBe(0);
    const trace = getSignalTrace().find((t) => t.pair === "BTC");
    expect(trace?.reason).toBe("not enough live data yet");
    expect((trace?.detail as { ticks: number; needed: number }).ticks).toBe(40);
    expect((trace?.detail as { ticks: number; needed: number }).needed).toBe(60);
    resetTuning();
  });

  it("accepts a tape with the full readings requirement met", () => {
    resetTuning();
    setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1, maxSigmaDist: 50, minTicks: 60 });
    const out = computeSignals(
      { BTC: tape(101, 0.00004, 60, inWindow) },
      { BTC: market() },
      { BTC: [0.6, 0.61] },
      inWindow,
    );
    expect(out.length).toBe(1);
    resetTuning();
  });

  it("does not count readings taken before the candle started", () => {
    resetTuning();
    setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1, maxSigmaDist: 50, minTicks: 60 });
    const candleStart = Math.floor(inWindow / 900_000) * 900_000;
    const stale = tape(101, 0.00004, 60, inWindow);
    // Shift half the readings into the previous candle.
    stale.ticks = stale.ticks.map((t, i) =>
      i < 30 ? { ...t, ts: candleStart - (30 - i) * 1_000 } : t,
    );
    const out = computeSignals(
      { BTC: stale },
      { BTC: market() },
      { BTC: [0.6, 0.61] },
      inWindow,
    );
    expect(out.length).toBe(0);
    const trace = getSignalTrace().find((t) => t.pair === "BTC");
    expect((trace?.detail as { ticks: number }).ticks).toBe(30);
    resetTuning();
  });
});
