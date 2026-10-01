import { describe, expect, it } from "vitest";

import {
  buildSnap,
  reentryBlock,
  SCALP_DRIFT_MIN_BP,
  SCALP_MOM_MIN_BP,
  SCALP_VOL_MIN,
  scalpSignal,
  type MinCandle,
} from "./scalper.server";

function snap(over: Partial<{ open: number; price: number; driftBp: number; momBp: number; volRatio: number }> = {}) {
  return {
    open: 100,
    price: 100.05,
    driftBp: 5,
    momBp: 3,
    volRatio: 1.6,
    ...over,
  };
}

describe("scalpSignal entry rules", () => {
  it("fires UP when drift, momentum and volume all agree", () => {
    expect(scalpSignal(snap())).toBe("UP");
  });

  it("fires DOWN on the mirror image", () => {
    expect(scalpSignal(snap({ price: 99.95, driftBp: -5, momBp: -3 }))).toBe("DOWN");
  });

  it("skips when drift is below the threshold even if momentum agrees", () => {
    expect(scalpSignal(snap({ driftBp: SCALP_DRIFT_MIN_BP - 0.1 }))).toBe("SKIP");
  });

  it("skips when momentum disagrees with drift", () => {
    expect(scalpSignal(snap({ momBp: -1 }))).toBe("SKIP");
    expect(scalpSignal(snap({ price: 99.95, driftBp: -5, momBp: 1 }))).toBe("SKIP");
  });

  it("skips on weak volume even with strong drift and momentum", () => {
    expect(scalpSignal(snap({ volRatio: SCALP_VOL_MIN - 0.01 }))).toBe("SKIP");
  });

  it("skips on missing data", () => {
    expect(scalpSignal(snap({ open: 0 }))).toBe("SKIP");
    expect(scalpSignal(snap({ price: NaN }))).toBe("SKIP");
  });

  it("uses the backtest-tuned thresholds", () => {
    expect(SCALP_DRIFT_MIN_BP).toBe(5);
    expect(SCALP_MOM_MIN_BP).toBe(3);
    expect(SCALP_VOL_MIN).toBe(1.5);
  });
});

describe("buildSnap", () => {
  const START = 1_700_000_000_000 - (1_700_000_000_000 % 900_000);

  function candles(): MinCandle[] {
    // 70 trailing 1m candles + 3 candles into the new 15m candle.
    const out: MinCandle[] = [];
    for (let i = 70; i >= 1; i--) out.push({ ts: START - i * 60_000, open: 100, close: 100, vol: 10 });
    out.push({ ts: START, open: 100, close: 100.02, vol: 18 });
    out.push({ ts: START + 60_000, open: 100.02, close: 100.04, vol: 20 });
    out.push({ ts: START + 120_000, open: 100.04, close: 100.06, vol: 22 });
    return out;
  }

  it("computes drift, momentum and volume ratio from 1m candles", () => {
    const s = buildSnap(candles(), START)!;
    expect(s.open).toBe(100);
    expect(s.price).toBe(100.06);
    expect(s.driftBp).toBeCloseTo(6, 5);
    // momentum over ~2 minutes: (100.06 - 100) / 100
    expect(s.momBp).toBeCloseTo(6, 5);
    // first-two-minutes avg vol 19 vs trailing avg 10 → 1.9x
    expect(s.volRatio).toBeCloseTo(1.9, 5);
  });

  it("returns null without the candle-open candle", () => {
    expect(buildSnap([], START)).toBeNull();
  });

  it("returns a SKIP-rated snap when volume is thin", () => {
    const cs = candles().map((c) => ({ ...c, vol: 1 }));
    const s = buildSnap(cs, START)!;
    expect(s.volRatio).toBeLessThan(SCALP_VOL_MIN);
    expect(scalpSignal(s)).toBe("SKIP");
  });
});

describe("scalper re-entry policy", () => {
  it("allows the first entry when nothing happened yet", () => {
    expect(reentryBlock([], 0)).toBeNull();
  });

  it("blocks while a position is open", () => {
    expect(reentryBlock([], 1)).toBe("open-position");
  });

  it("allows re-entry after take-profit and timeout exits", () => {
    expect(reentryBlock([{ exit_reason: "profit" }], 0)).toBeNull();
    expect(
      reentryBlock([{ exit_reason: "profit" }, { exit_reason: "time" }], 0),
    ).toBeNull();
  });

  it("blocks the rest of the candle after a stop-loss", () => {
    expect(reentryBlock([{ exit_reason: "stop" }], 0)).toBe("stop-cooldown");
    expect(
      reentryBlock([{ exit_reason: "profit" }, { exit_reason: "stop" }], 0),
    ).toBe("stop-cooldown");
  });

  it("caps round trips at three per candle", () => {
    const three = [
      { exit_reason: "profit" },
      { exit_reason: "time" },
      { exit_reason: "profit" },
    ];
    expect(reentryBlock(three, 0)).toBe("max-trips");
  });
});
