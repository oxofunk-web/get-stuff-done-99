/**
 * Kalshi V2 `/portfolio/events/orders` uses a single unified book quoted on the
 * YES price scale:
 *   - buying YES  => side "bid", price = the YES price you pay
 *   - buying NO   => side "ask", price = 100¢ - (the NO price you pay)
 *
 * The side and the price flip are ONE decision — never edit one without the
 * other, or every live trade silently inverts. Locked by unit tests in
 * `order-map.test.ts`.
 */

/**
 * Contracts resting at the touch on the side an order would take. Buying NO
 * lifts the YES bid, so NO depth is the YES bid size. Client-safe: the engines
 * use it to skip or shrink orders before anything is sent to Kalshi.
 */
export function restingDepth(
  m: { yesAskSize: number; yesBidSize: number },
  side: "YES" | "NO",
) {
  return Math.floor(side === "YES" ? m.yesAskSize : m.yesBidSize);
}

export interface BookOrder {
  side: "bid" | "ask";
  yesPriceCents: number;
  /** Price string in the exact format Kalshi expects (dollars, 4dp). */
  price: string;
}

export function mapOrderToBook(side: "yes" | "no", limitCents: number): BookOrder {
  const clamped = Math.min(99, Math.max(1, Math.round(limitCents)));
  const yesPriceCents = side === "yes" ? clamped : 100 - clamped;
  return {
    side: side === "yes" ? "bid" : "ask",
    yesPriceCents,
    price: (yesPriceCents / 100).toFixed(4),
  };
}
