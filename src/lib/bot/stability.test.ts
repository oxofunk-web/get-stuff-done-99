import { describe, expect, it } from "vitest";

import {
  activeCandleCloseMs,
  advanceStableSignal,
  freshMarketSupportsSignal,
  isStable,
  marketMatchesActiveCandle,
} from "./stability";
import type { KalshiMarket, Signal } from "./types";
import { gradeContract } from "./settle.server";

const signal = { pair: "BTC", dir: "YES" } as Signal;
const market = {
  pair: "BTC",
  ticker: "BTC-LOCKED",
  strike: 100,
  strikeType: "floor",
  yesBid: 0.54,
  yesAsk: 0.55,
  yesMid: 0.545,
  spread: 0.01,
  vol: 100,
} as KalshiMarket;

describe("signal stability", () => {
  it("accepts only the contract closing on the active candle boundary", () => {
    const now = Date.UTC(2026, 8, 5, 2, 31, 0);
    expect(activeCandleCloseMs(now)).toBe(Date.UTC(2026, 8, 5, 2, 45, 0));
    expect(marketMatchesActiveCandle("2026-09-05T02:45:00.000Z", now)).toBe(true);
    expect(marketMatchesActiveCandle("2026-09-05T02:30:00.000Z", now)).toBe(false);
  });

  it("requires three time-separated observations spanning a real window", () => {
    const first = advanceStableSignal(undefined, "BTC:TICKER:YES", 1_000, 1_000);
    const tooSoon = advanceStableSignal(first, first.key, 1_200, 1_000);
    const second = advanceStableSignal(tooSoon, first.key, 4_000, 1_000);
    const third = advanceStableSignal(second, first.key, 7_100, 1_000);
    expect(first.count).toBe(1);
    expect(tooSoon.count).toBe(1);
    expect(isStable(second)).toBe(false);
    expect(third.count).toBe(3);
    expect(isStable(third)).toBe(true);
    expect(advanceStableSignal(third, "BTC:TICKER:NO", 9_200, 1_000).count).toBe(1);
  });

  it("restarts the window when the cushion is decaying toward the strike", () => {
    const a = advanceStableSignal(undefined, "BTC:T:YES", 1_000, 1_000, 1.4);
    const b = advanceStableSignal(a, a.key, 4_000, 1_000, 1.5);
    expect(b.count).toBe(2);
    const shrinking = advanceStableSignal(b, a.key, 7_000, 1_000, 1.1);
    expect(shrinking.count).toBe(1);
    expect(isStable(shrinking)).toBe(false);
  });

  it("rejects a fresh book that flips against the scored direction", () => {
    expect(freshMarketSupportsSignal(signal, market, 101, 0.05)).toBe(true);
    expect(freshMarketSupportsSignal(signal, { ...market, yesMid: 0.49 }, 101, 0.05)).toBe(false);
    expect(freshMarketSupportsSignal(signal, market, 99, 0.05)).toBe(false);
  });

  it("grades a fill against its stored strike rather than another listed strike", () => {
    expect(gradeContract("YES", 101, 100)).toBe(true);
    expect(gradeContract("YES", 101, 102)).toBe(false);
    expect(gradeContract("NO", 101, 102)).toBe(true);
  });

  it("handles cap contracts without reversing their result", () => {
    expect(gradeContract("YES", 99, 100, "cap")).toBe(true);
    expect(gradeContract("NO", 101, 100, "cap")).toBe(true);
    expect(freshMarketSupportsSignal(signal, { ...market, strikeType: "cap" }, 99, 0.05)).toBe(true);
  });
});