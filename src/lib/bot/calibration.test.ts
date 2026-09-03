import { describe, expect, it } from "vitest";

import { calibrate, calibrateFor, emptyTable, PAIR_FULL_TRUST, type CalibrationTable } from "./calibration";

/** Global table: 86-90 band sitting at a 70% win rate on plenty of samples. */
function globalTable(): CalibrationTable {
  const t = emptyTable();
  const b = t.find((x) => x.lo === 85)!;
  b.n = 200;
  b.wins = 140;
  return t;
}

function pairTable(n: number, wins: number): CalibrationTable {
  const t = emptyTable();
  const b = t.find((x) => x.lo === 85)!;
  b.n = n;
  b.wins = wins;
  return t;
}

describe("per-pair calibration", () => {
  const g = globalTable();
  const global = calibrate(87, g);

  it("falls back to the global curve with no pair history", () => {
    expect(calibrateFor("BNB", 87, g, {})).toBeCloseTo(global, 6);
    expect(calibrateFor("BNB", 87, g, undefined)).toBeCloseTo(global, 6);
  });

  it("barely moves on a thin pair record", () => {
    const thin = calibrateFor("DOGE", 87, g, { DOGE: pairTable(2, 2) });
    expect(Math.abs(thin - global)).toBeLessThan(0.05);
  });

  it("tracks the pair's own rate once history is deep", () => {
    const winner = calibrateFor("SOL", 87, g, { SOL: pairTable(PAIR_FULL_TRUST * 2, PAIR_FULL_TRUST * 2 * 0.9) });
    const loser = calibrateFor("ETH", 87, g, { ETH: pairTable(PAIR_FULL_TRUST * 2, PAIR_FULL_TRUST * 2 * 0.5) });
    expect(winner).toBeGreaterThan(global);
    expect(loser).toBeLessThan(global);
    expect(winner).toBeGreaterThan(0.85);
    expect(loser).toBeLessThan(0.6);
  });

  it("stays inside probability bounds", () => {
    expect(calibrateFor("XRP", 99, g, { XRP: pairTable(100, 100) })).toBeLessThanOrEqual(0.99);
    expect(calibrateFor("XRP", 99, g, { XRP: pairTable(100, 0) })).toBeGreaterThanOrEqual(0.01);
  });
});
