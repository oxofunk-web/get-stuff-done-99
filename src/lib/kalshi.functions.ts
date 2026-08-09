import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { PAIRS } from "./bot/constants";
import { authedKalshi, fetchMarket, fetchOpenMarket, normalizeMarket } from "./kalshi.server";

/** Live YES/NO orderbook for every 15-minute crypto series. Public data. */
export const getMarkets = createServerFn({ method: "GET" }).handler(async () => {
  const results = await Promise.all(
    PAIRS.map(async (p) => {
      const raw = await fetchOpenMarket(p.series);
      if (!raw) return null;
      return { pair: p.id, ...normalizeMarket(raw) };
    }),
  );
  const markets = results.filter((m): m is NonNullable<typeof m> => m !== null);
  return { markets, ok: markets.length > 0, ts: Date.now() };
});

/** Whether live trading credentials are configured on the server. */
export const getLiveStatus = createServerFn({ method: "GET" }).handler(async () => {
  const keyId = process.env["KALSHI_API_KEY_ID"];
  const pem = process.env["KALSHI_PRIVATE_KEY"];
  if (!keyId || !pem) return { configured: false, balance: null as number | null, error: null };
  try {
    const bal = await authedKalshi<{ balance?: number; balance_dollars?: string }>(
      { keyId, pem },
      "GET",
      "/portfolio/balance",
    );
    return {
      configured: true,
      balance: dollars(bal.balance_dollars, bal.balance),
      error: null as string | null,
    };
  } catch (e) {
    return {
      configured: true,
      balance: null as number | null,
      error: e instanceof Error ? e.message : "Kalshi auth failed",
    };
  }
});

const orderInput = z.object({
  ticker: z.string().min(3).max(80),
  side: z.enum(["yes", "no"]),
  priceCents: z.number().int().min(1).max(99),
  count: z.number().int().min(1).max(500),
});

/** Places a real fill-or-kill limit order on Kalshi. Live mode only. */
export const placeOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => orderInput.parse(input))
  .handler(async ({ data }) => {
    const keyId = process.env["KALSHI_API_KEY_ID"];
    const pem = process.env["KALSHI_PRIVATE_KEY"];
    if (!keyId || !pem) {
      return { ok: false as const, error: "Live trading keys are not configured." };
    }
    // Re-read the book right before sending: quotes from the 8s poll are stale,
    // and a limit that doesn't cross the top of book gets rejected outright.
    const fresh = await fetchMarket(data.ticker);
    const m = fresh ? normalizeMarket(fresh) : null;
    const restingSize = Number(
      (data.side === "yes" ? fresh?.yes_ask_size_fp : fresh?.yes_bid_size_fp) ?? 0,
    );

    const quoteCents = m
      ? Math.round((data.side === "yes" ? m.yesAsk : m.noAsk) * 100)
      : data.priceCents;
    // Pay up to 2¢ through the touch so a taker order actually crosses.
    const limitCents = Math.min(
      99,
      Math.max(1, Math.max(data.priceCents, quoteCents || data.priceCents) + 2),
    );
    const count = Math.max(
      1,
      restingSize > 0 ? Math.min(data.count, Math.floor(restingSize)) : data.count,
    );

    // Unified book: `bid` buys YES, `ask` sells YES (== buying NO at 100 - price).
    const yesPriceCents = data.side === "yes" ? limitCents : 100 - limitCents;
    const body: Record<string, unknown> = {
      ticker: data.ticker,
      client_order_id: crypto.randomUUID(),
      side: data.side === "yes" ? "bid" : "ask",
      count: count.toFixed(2),
      price: (yesPriceCents / 100).toFixed(4),
      // IOC fills whatever rests and cancels the remainder; FOK rejects the
      // whole order with `fill_or_kill_insufficient_resting_volume`.
      time_in_force: "immediate_or_cancel",
      self_trade_prevention_type: "taker_at_cross",
      post_only: false,
    };

    try {
      const res = await authedKalshi<{
        order_id?: string;
        fill_count?: string;
        remaining_count?: string;
        average_fill_price_dollars?: string;
        average_fill_price?: string;
        order?: { order_id?: string; status?: string };
      }>({ keyId, pem }, "POST", "/portfolio/events/orders", body);
      const filled = Number(res.fill_count ?? 0);
      if (!Number.isFinite(filled) || filled <= 0) {
        return {
          ok: false as const,
          error: `No resting volume at ${limitCents}¢ — nothing filled, order canceled.`,
        };
      }
      const avg = res.average_fill_price_dollars ?? res.average_fill_price;
      return {
        ok: true as const,
        orderId: res.order_id ?? res.order?.order_id ?? null,
        filled,
        priceCents: limitCents,
        status: `filled ${filled}${avg ? ` @ ${(Number(avg) * (Number(avg) <= 1 ? 100 : 1)).toFixed(0)}¢` : ""}`,
      };
    } catch (e) {
      console.error("Kalshi order failed", e);
      return { ok: false as const, error: friendlyOrderError(e) };
    }
  });

function friendlyOrderError(e: unknown) {
  const raw = e instanceof Error ? e.message : "Order rejected";
  if (/insufficient_balance/i.test(raw))
    return "Insufficient Kalshi balance for this bet size — lower the stake or deposit funds.";
  if (/resting_volume/i.test(raw))
    return "Not enough resting volume to fill — the book is too thin right now.";
  if (/market_not_open|not_active|closed/i.test(raw))
    return "That 15-minute market is no longer accepting orders.";
  return raw;
}
interface RawPosition {
  ticker: string;
  position?: number;
  market_exposure?: number;
  realized_pnl?: number;
  total_traded?: number;
  position_fp?: string;
  market_exposure_dollars?: string;
  realized_pnl_dollars?: string;
  total_traded_dollars?: string;
  fees_paid_dollars?: string;
}

/** Kalshi returns either integer cents or newer `*_dollars` strings. */
function dollars(dollarStr: string | undefined, cents: number | undefined) {
  if (dollarStr !== undefined && dollarStr !== "") {
    const d = Number(dollarStr);
    if (Number.isFinite(d)) return d;
  }
  const c = Number(cents ?? 0);
  return Number.isFinite(c) ? c / 100 : 0;
}

/** Wallet balance + realized/open P&L straight from the Kalshi account. */
export const getPortfolio = createServerFn({ method: "GET" }).handler(async () => {
  const keyId = process.env["KALSHI_API_KEY_ID"];
  const pem = process.env["KALSHI_PRIVATE_KEY"];
  if (!keyId || !pem) {
    return {
      configured: false as const,
      balance: null as number | null,
      realized: 0,
      exposure: 0,
      positions: [] as { ticker: string; count: number; exposure: number; realized: number }[],
      error: null as string | null,
    };
  }
  try {
    const [bal, pos] = await Promise.all([
      authedKalshi<{ balance?: number; balance_dollars?: string }>(
        { keyId, pem },
        "GET",
        "/portfolio/balance",
      ),
      authedKalshi<{ market_positions?: RawPosition[] }>(
        { keyId, pem },
        "GET",
        "/portfolio/positions?count_filter=position&limit=200",
      ),
    ]);
    const raw = pos.market_positions ?? [];
    const positions = raw
      .map((p) => ({
        ticker: p.ticker,
        count: p.position_fp !== undefined ? Number(p.position_fp) : (p.position ?? 0),
        exposure: dollars(p.market_exposure_dollars, p.market_exposure),
        realized:
          dollars(p.realized_pnl_dollars, p.realized_pnl) - dollars(p.fees_paid_dollars, undefined),
      }))
      .filter((p) => p.count !== 0 || p.exposure !== 0);
    return {
      configured: true as const,
      balance: dollars(bal.balance_dollars, bal.balance),
      realized: positions.reduce((a, p) => a + p.realized, 0),
      exposure: positions.reduce((a, p) => a + p.exposure, 0),
      positions,
      error: null as string | null,
    };
  } catch (e) {
    return {
      configured: true as const,
      balance: null as number | null,
      realized: 0,
      exposure: 0,
      positions: [] as { ticker: string; count: number; exposure: number; realized: number }[],
      error: e instanceof Error ? e.message : "Kalshi portfolio failed",
    };
  }
});
