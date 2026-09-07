import { describe, expect, it } from "vitest";

import { candleCloseMs, gradeContract, MAX_SETTLE_ATTEMPTS, VOID_AFTER_MS } from "./settle.server";
import { GATE_SECS } from "./constants";
import { computeSignals } from "./signals";
import { resetTuning, setTuning } from "./tuning";
import type { KalshiMarket, SpotState } from "./types";

function tape(base: number, drift: number, ticks: number, at: number): SpotState {
  const start = at - ticks * 1_000;
  const rows = Array.from({ length: ticks }, (_, i) => ({
    price: base * (1 + drift * i + (i % 2 === 0 ? 0.00015 : -0.00015)),
    ts: start + i * 1_000,
  }));
  const last = rows[rows.length - 1]!;
  return { price: last.price, prev: rows[rows.length - 2]!.price, change24h: 0, ts: last.ts, ticks: rows };
}

function market(): KalshiMarket {
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
  };
}

/** Mirrors the void rule inside settleOne so the policy itself is pinned. */
function shouldVoid(attempts: number, candleId: number, now: number) {
  return attempts >= MAX_SETTLE_ATTEMPTS && now > candleCloseMs(candleId) + VOID_AFTER_MS;
}

describe("settlement retries and voiding", () => {
  const candleId = Math.floor(Date.now() / 900_000) - 10;

  it("keeps retrying while the exchange may still publish a result", () => {
    const justClosed = candleCloseMs(candleId) + 60_000;
    expect(shouldVoid(1, candleId, justClosed)).toBe(false);
    expect(shouldVoid(MAX_SETTLE_ATTEMPTS, candleId, justClosed)).toBe(false);
  });

  it("voids only after the retries run out and the grace period passes", () => {
    const late = candleCloseMs(candleId) + VOID_AFTER_MS + 1;
    expect(shouldVoid(MAX_SETTLE_ATTEMPTS - 1, candleId, late)).toBe(false);
    expect(shouldVoid(MAX_SETTLE_ATTEMPTS, candleId, late)).toBe(true);
  });

  it("grades cap contracts by the exchange rule, not the floor rule", () => {
    expect(gradeContract("YES", 99, 100, "cap")).toBe(true);
    expect(gradeContract("YES", 101, 100, "cap")).toBe(false);
    expect(gradeContract("NO", 101, 100, "cap")).toBe(true);
  });
});

describe("trade window", () => {
  const candleStart = Math.floor(Date.now() / 900_000) * 900_000;

  it("scores once the gate opens", () => {
    resetTuning();
    setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1, maxSigmaDist: 50 });
    const at = candleStart + (GATE_SECS + 30) * 1_000;
    const out = computeSignals({ BTC: tape(101, 0.00004, 60, at) }, { BTC: market() }, {}, at);
    expect(out.length).toBe(1);
    resetTuning();
  });

  it("stays shut before the gate opens", () => {
    resetTuning();
    setTuning({ threshold: 0, minSigmaDist: 0, evMargin: -1, maxSigmaDist: 50 });
    const at = candleStart + 60_000;
    const out = computeSignals({ BTC: tape(101, 0.00004, 60, at) }, { BTC: market() }, {}, at);
    expect(out.length).toBe(0);
    resetTuning();
  });
});
