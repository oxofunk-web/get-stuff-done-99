import { describe, expect, it } from "vitest";
import {
  CANDLE_MS,
  COOLDOWN_CANDLES,
  MANUAL_RESUME,
  dropVetoed,
  pairVetoed,
  rankScore,
  rankSignals,
  type PairEdgeMap,
} from "./ranking";
import type { Signal } from "./types";

const sig = (pair: string, over: Partial<Signal> = {}): Signal =>
  ({
    id: `${pair}-1`,
    pair,
    dir: "YES",
    conf: 90,
    yesMid: 0.5,
    spread: 0.02,
    spotMom: 0,
    kMom: 0,
    lagDetected: false,
    calibrated: 0.9,
    entry: 0.5,
    ev: 0.2,
    sigmaDist: 1,
    skew: 0,
    reason: "",
    elapsed: 600,
    remain: 300,
    ...over,
  }) as Signal;

const row = (pair: string, o: Partial<PairEdgeMap[string]> = {}) =>
  ({ pair, n: 30, fired: 20, firedWins: 17, avgEntry: 0.6, pnl: 10, trades: 8, ...o }) as PairEdgeMap[string];

describe("ranking", () => {
  it("favors the pair with the proven higher win rate", () => {
    const map: PairEdgeMap = {
      GOOD: row("GOOD", { fired: 20, firedWins: 18, avgEntry: 0.6 }),
      MEH: row("MEH", { fired: 20, firedWins: 10, avgEntry: 0.6 }),
    };
    const order = rankSignals([sig("MEH"), sig("GOOD")], map).map((s) => s.pair);
    expect(order[0]).toBe("GOOD");
  });

  it("penalizes expensive average entries", () => {
    const cheap = { C: row("C", { fired: 20, firedWins: 14, avgEntry: 0.5 }) } as PairEdgeMap;
    const pricey = { C: row("C", { fired: 20, firedWins: 14, avgEntry: 0.9 }) } as PairEdgeMap;
    expect(rankScore(sig("C"), cheap)).toBeGreaterThan(rankScore(sig("C"), pricey));
  });

  it("shrinks edge for thin samples", () => {
    const thin = { T: row("T", { fired: 2, firedWins: 2, avgEntry: 0.6 }) } as PairEdgeMap;
    const full = { T: row("T", { fired: 20, firedWins: 20, avgEntry: 0.6 }) } as PairEdgeMap;
    expect(rankScore(sig("T"), thin)).toBeLessThan(rankScore(sig("T"), full));
  });

  it("pauses a losing pair but re-arms on a probe candle", () => {
    const map = { LOSS: row("LOSS", { trades: 6, pnl: -12 }) } as PairEdgeMap;
    const probe = COOLDOWN_CANDLES * 10 * CANDLE_MS; // index divisible by cooldown
    const between = probe + CANDLE_MS;
    expect(pairVetoed("LOSS", map, between)).toBe(true);
    expect(pairVetoed("LOSS", map, probe)).toBe(false);
    expect(dropVetoed([sig("LOSS")], map, between)).toHaveLength(0);
  });

  it("keeps manually resumed pairs tradable until a new loss", () => {
    const base = MANUAL_RESUME["BTC"]!;
    const between = COOLDOWN_CANDLES * 10 * CANDLE_MS + CANDLE_MS;
    expect(pairVetoed("BTC", { BTC: row("BTC", { trades: 7, pnl: base }) } as PairEdgeMap, between)).toBe(false);
    expect(pairVetoed("BTC", { BTC: row("BTC", { trades: 7, pnl: base - 5 }) } as PairEdgeMap, between)).toBe(true);
  });
});
