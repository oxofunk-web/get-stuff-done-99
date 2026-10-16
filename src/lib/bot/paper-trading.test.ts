import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], order: vi.fn(), markets: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({
    select: () => { const q = { eq: () => q, limit: async () => ({ data: [] }) }; return q; },
    insert: async (row: Record<string, unknown>) => { mocks.rows.push(row); return { error: null }; },
  }) },
}));
vi.mock("../kalshi.server", async (original) => ({
  ...await original<typeof import("../kalshi.server")>(),
  fetchCandleMarketsWithReason: mocks.markets,
  placeLiveOrder: mocks.order,
}));

import { trade } from "./autotrade.server";
import { settlementSide } from "./settle.server";

describe("paper execution on real quotes", () => {
  beforeEach(() => { mocks.rows.length = 0; mocks.order.mockClear(); });
  it("records a simulated fill at the quoted 60 cents without calling the real order path", async () => {
    mocks.markets.mockResolvedValue({ markets: [{ ticker: "KXBTC15M-TEST", floor_strike: 100, yes_ask: 60, yes_bid: 59, yes_ask_size_fp: "8" }], error: null });
    await trade("BTC", "UP", 1800000, 10, 110, false, { spot: 110, timeFrac: 0.1, drift: 0, sigma: 0.001 } as never);
    expect(mocks.rows[0]).toMatchObject({ mode: "paper", status: "placed", entry_price: 0.6, contracts: 8, stake: 4.8, ticker: "KXBTC15M-TEST" });
    expect(mocks.order).not.toHaveBeenCalled();
  });
  it("never invents a fill when visible market depth is missing", async () => {
    mocks.markets.mockResolvedValue({ markets: [{ ticker: "KXBTC15M-TEST", floor_strike: 100, yes_ask: 60, yes_bid: 59 }], error: null });
    await trade("BTC", "UP", 1800000, 10, 110, true, { spot: 110, timeFrac: 0.1, drift: 0, sigma: 0.001 } as never);
    expect(mocks.rows[0]).toMatchObject({ mode: "paper", status: "skipped", visible_depth: 0 });
    expect(mocks.order).not.toHaveBeenCalled();
  });
  it("grades locked directions against floor and cap outcomes", () => {
    expect(settlementSide("UP", "floor")).toBe("yes");
    expect(settlementSide("DOWN", "floor")).toBe("no");
    expect(settlementSide("UP", "cap")).toBe("no");
    expect(settlementSide("DOWN", "cap")).toBe("yes");
  });
});