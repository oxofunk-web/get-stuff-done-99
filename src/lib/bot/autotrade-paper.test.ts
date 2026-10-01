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
const fetchOpenMarketWithReason = vi.hoisted(() => vi.fn());

vi.mock("../kalshi.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../kalshi.server")>();
  return {
    ...actual,
    fetchOpenMarketWithReason,
    placeLiveOrder,
  };
});

import { trade } from "./autotrade.server";

const CANDLE = 1_700_000_000_000;

function market(yesAskCents: number, strike = 100) {
  return {
    market: {
      ticker: "KXBTC15M-TEST",
      floor_strike: strike,
      yes_bid: yesAskCents - 2,
      yes_ask: yesAskCents,
    },
    error: null,
  };
}

beforeEach(() => {
  inserted.length = 0;
  placeLiveOrder.mockClear();
  fetchOpenMarketWithReason.mockReset();
  delete process.env["KALSHI_API_KEY_ID"];
  delete process.env["KALSHI_PRIVATE_KEY"];
});

describe("paper trading", () => {
  it("fills a simulated paper trade with no Kalshi keys and never places an order", async () => {
    fetchOpenMarketWithReason.mockResolvedValue(market(60) as never);
    // UP with spot above the floor strike -> buys YES at 60¢ (under the 75¢ cap).
    const msg = await trade("BTC", "UP", CANDLE, 10, 101, true);
    expect(msg).toBe("BTC: PAPER FILLED 16 @ 60¢");
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
    fetchOpenMarketWithReason.mockResolvedValue(market(60) as never);
    const msg = await trade("BTC", "UP", CANDLE, 10, 101, false);
    expect(msg).toBe("BTC: Kalshi key missing");
    expect(placeLiveOrder).not.toHaveBeenCalled();
    expect(inserted.some((r) => r["status"] === "placed")).toBe(false);
  });

  it("paper mode still respects the 75¢ max entry price", async () => {
    fetchOpenMarketWithReason.mockResolvedValue(market(80) as never);
    const msg = await trade("BTC", "UP", CANDLE, 10, 101, true);
    expect(msg).toBe("BTC: too expensive");
    expect(placeLiveOrder).not.toHaveBeenCalled();
    expect(inserted.some((r) => r["status"] === "placed")).toBe(false);
  });

  it("paper mode skips when price is on the wrong side of the line", async () => {
    fetchOpenMarketWithReason.mockResolvedValue(market(60) as never);
    // UP call but spot below the floor strike -> no trade.
    const msg = await trade("BTC", "UP", CANDLE, 10, 99, true);
    expect(msg).toBe("BTC: wrong side of line");
    expect(placeLiveOrder).not.toHaveBeenCalled();
  });
});
