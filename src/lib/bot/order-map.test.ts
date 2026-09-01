import { describe, expect, it } from "vitest";

import { mapOrderToBook } from "./order-map";

describe("mapOrderToBook — YES/NO ↔ bid/ask mapping", () => {
  it("buys YES on the bid at the YES price", () => {
    expect(mapOrderToBook("yes", 40)).toEqual({
      side: "bid",
      yesPriceCents: 40,
      price: "0.4000",
    });
  });

  it("buys NO on the ask at the complement of the NO price", () => {
    expect(mapOrderToBook("no", 40)).toEqual({
      side: "ask",
      yesPriceCents: 60,
      price: "0.6000",
    });
  });

  it("keeps side and price flip coupled across the whole range", () => {
    for (let c = 1; c <= 99; c += 1) {
      const yes = mapOrderToBook("yes", c);
      const no = mapOrderToBook("no", c);
      expect(yes.side).toBe("bid");
      expect(no.side).toBe("ask");
      expect(yes.yesPriceCents).toBe(c);
      expect(no.yesPriceCents).toBe(100 - c);
      // A YES buy at c and a NO buy at 100-c hit the same book price.
      expect(mapOrderToBook("no", 100 - c).price).toBe(yes.price);
    }
  });

  it("clamps to the 1¢–99¢ tradable band", () => {
    expect(mapOrderToBook("yes", 0).yesPriceCents).toBe(1);
    expect(mapOrderToBook("yes", 140).yesPriceCents).toBe(99);
    expect(mapOrderToBook("no", 0).yesPriceCents).toBe(99);
    expect(mapOrderToBook("no", 140).yesPriceCents).toBe(1);
  });

  it("always formats price as a 4dp dollar string", () => {
    expect(mapOrderToBook("yes", 7).price).toBe("0.0700");
    expect(mapOrderToBook("no", 7).price).toBe("0.9300");
  });
});
