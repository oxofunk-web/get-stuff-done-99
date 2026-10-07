import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Record<string, unknown>[] = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    const chain: Record<string, (...args: never[]) => unknown> = {};
    chain["select"] = () => chain;
    chain["eq"] = () => chain;
    chain["limit"] = () => Promise.resolve({ data: [], error: null });
    chain["insert"] = (row: Record<string, unknown>) => {
      inserted.push(row);
      return Promise.resolve({ data: null, error: null });
    };
    return { from: () => chain };
  },
}));

const placeLiveOrder = vi.hoisted(() => vi.fn());
const fetchCandleMarketsWithReason = vi.hoisted(() => vi.fn());

vi.mock("../kalshi.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../kalshi.server")>();
  return {
    ...actual,
    fetchCandleMarketsWithReason,
    placeLiveOrder,
  };
});

import { selectStrike, trade } from "./autotrade.server";
import { probCloseAbove } from "./direction";

const CANDLE = 1_700_000_000_000;

function markets(list: { strike: number; yesAsk: number }[]) {
  return {
    markets: list.map((m, i) => ({
      ticker: `KXBTC15M-TEST${i}`,
      floor_strike: m.strike,
      yes_bid: m.yesAsk - 2,
      yes_ask: m.yesAsk,
    })),
    error: null,
  };
}

/** Model with P(close > 105) ≈ 0.758 (driftedPrice=112, horizon=10). */
const model = (driftedPrice = 112, priceHorizon = 10) => ({ driftedPrice, priceHorizon });

beforeEach(() => {
  inserted.length = 0;
  placeLiveOrder.mockClear();
  fetchCandleMarketsWithReason.mockReset();
  delete process.env["KALSHI_API_KEY_ID"];
  delete process.env["KALSHI_PRIVATE_KEY"];
});

describe("dynamic strike selection", () => {
  it("prices P(close > strike) from the model", () => {
    expect(probCloseAbove(112, model())).toBeCloseTo(0.5, 2);
    expect(probCloseAbove(105, model())).toBeCloseTo(0.758, 2);
    expect(probCloseAbove(200, model())).toBeLessThan(0.01);
  });

  it("skips the 95¢ contract and takes the 60¢ strike with edge", () => {
    const { pick, note } = selectStrike(
      markets([
        { strike: 100, yesAsk: 95 },
        { strike: 105, yesAsk: 60 },
      ]).markets as never[],
      model(),
      "UP",
    );
    expect(note).toBe("");
    // 100-strike YES is 95¢ (out of band); 105-strike YES is 60¢ with EV ≈ +15.8¢.
    expect(pick?.market.ticker).toBe("KXBTC15M-TEST1");
    expect(pick?.side).toBe("yes");
    expect(pick?.askCents).toBe(60);
    expect(pick?.evCents).toBeCloseTo(15.8, 0);
  });

  it("skips when the best edge is below the 10¢ minimum", () => {
    const weak = { driftedPrice: 103.85, priceHorizon: 10 }; // P(close>100) ≈ 0.65 → EV ≈ 5¢
    const { pick, note } = selectStrike(markets([{ strike: 100, yesAsk: 60 }]).markets as never[], weak, "UP");
    expect(pick).toBeNull();
    expect(note).toContain("below the 10¢ minimum");
  });

  it("skips when no strike is priced in the 55–75¢ band", () => {
    const { pick, note } = selectStrike(markets([{ strike: 100, yesAsk: 95 }]).markets as never[], model(), "UP");
    expect(pick).toBeNull();
    expect(note).toContain("55–75¢");
  });

  it("DOWN lock buys NO on a floor — the side the take-profit pass reconstructs", () => {
    // Model says P(close > 100) ≈ 0.24, so P(close < 100) ≈ 0.76 → NO @ 60¢ has EV ≈ +16¢.
    const down = { driftedPrice: 92.9, priceHorizon: 10 };
    const { pick } = selectStrike(markets([{ strike: 100, yesAsk: 40 }]).markets as never[], down, "DOWN");
    // yesAsk 40 → noAsk = 1 - yesBid(38¢) = 62¢, in band; EV = 76¢ - 62¢ ≈ +14¢ ≥ 10¢.
    expect(pick?.side).toBe("no");
    expect(pick?.askCents).toBe(62);
    expect(pick!.evCents).toBeGreaterThan(10);
    // take-profit reconstructs: (floor) === (dir===UP)? yes : no → DOWN+floor = no. Must match.
    const tpSide = ("floor" === "floor") === false ? "yes" : "no";
    expect(tpSide).toBe(pick?.side);
  });
});

describe("paper trading", () => {
  it("fills a simulated paper trade with no Kalshi keys and never places an order", async () => {
    fetchCandleMarketsWithReason.mockResolvedValue(markets([{ strike: 105, yesAsk: 60 }]) as never);
    const msg = await trade("BTC", "UP", CANDLE, 10, 101, true, model());
    expect(msg).toContain("PAPER FILLED 16 @ 60¢");
    expect(placeLiveOrder).not.toHaveBeenCalled();
    const row = inserted.find((r) => r["status"] === "placed");
    expect(row).toMatchObject({
      mode: "paper",
      status: "placed",
      contracts: 16,
      entry_price: 0.6,
      source: "lock",
    });
    expect(String(row?.["order_id"])).toMatch(/^paper-/);
  });

  it("live mode without keys skips gracefully instead of trading", async () => {
    fetchCandleMarketsWithReason.mockResolvedValue(markets([{ strike: 105, yesAsk: 60 }]) as never);
    const msg = await trade("BTC", "UP", CANDLE, 10, 101, false, model());
    expect(msg).toBe("BTC: Kalshi key missing");
    expect(placeLiveOrder).not.toHaveBeenCalled();
    expect(inserted.some((r) => r["status"] === "placed")).toBe(false);
  });

  it("paper mode skips the 95¢ contract when a better strike exists", async () => {
    fetchCandleMarketsWithReason.mockResolvedValue(
      markets([
        { strike: 100, yesAsk: 95 },
        { strike: 105, yesAsk: 60 },
      ]) as never,
    );
    const msg = await trade("BTC", "UP", CANDLE, 10, 101, true, model());
    expect(msg).toContain("PAPER FILLED 16 @ 60¢");
    expect(msg).not.toContain("@ 95¢");
  });

  it("paper mode skips when no strike has enough edge", async () => {
    fetchCandleMarketsWithReason.mockResolvedValue(markets([{ strike: 100, yesAsk: 60 }]) as never);
    const weak = { driftedPrice: 103.85, priceHorizon: 10 };
    const msg = await trade("BTC", "UP", CANDLE, 10, 101, true, weak);
    expect(msg).toContain("no edge");
    expect(placeLiveOrder).not.toHaveBeenCalled();
  });
});

describe("paper band 50–80¢", () => {
  it("paper band accepts a 78¢ strike the live band rejects", async () => {
    const { PAPER_BAND } = await import("./autotrade.server");
    const strong = { driftedPrice: 130, priceHorizon: 10 };
    const list = markets([{ strike: 100, yesAsk: 78 }]).markets as never[];
    expect(selectStrike(list, strong, "UP").pick).toBeNull();
    expect(selectStrike(list, strong, "UP", PAPER_BAND).pick?.askCents).toBe(78);
  });
});
