import { describe, expect, it } from "vitest";

import {
  activeCandleCloseMs,
  advanceStableSignal,
  freshMarketSupportsSignal,
  marketMatchesActiveCandle,
} from "./stability";
import type { KalshiMarket, Signal } from "./types";
import { gradeContract } from "./settle.server";

const signal = { pair: "BTC", dir: "YES" } as Signal;
const market = {
  pair: "BTC",
  ticker: "BTC-LOCKED",
  strike: 100,
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

  it("requires two time-separated observations of the same contract and direction", () => {
    const first = advanceStableSignal(undefined, "BTC:TICKER:YES", 1_000, 1_000);
    const tooSoon = advanceStableSignal(first, first.key, 1_200, 1_000);
    const stable = advanceStableSignal(tooSoon, first.key, 2_100, 1_000);
    expect(first.count).toBe(1);
    expect(tooSoon.count).toBe(1);
    expect(stable.count).toBe(2);
    expect(advanceStableSignal(stable, "BTC:TICKER:NO", 3_200, 1_000).count).toBe(1);
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
});