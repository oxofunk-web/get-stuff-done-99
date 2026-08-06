import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { PAIRS } from "./bot/constants";
import { authedKalshi, fetchOpenMarket, normalizeMarket } from "./kalshi.server";

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
    const bal = await authedKalshi<{ balance: number }>({ keyId, pem }, "GET", "/portfolio/balance");
    return { configured: true, balance: bal.balance / 100, error: null as string | null };
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
    const body: Record<string, unknown> = {
      ticker: data.ticker,
      client_order_id: crypto.randomUUID(),
      action: "buy",
      side: data.side,
      type: "limit",
      time_in_force: "fill_or_kill",
      count: data.count,
    };
    if (data.side === "yes") body["yes_price"] = data.priceCents;
    else body["no_price"] = data.priceCents;

    try {
      const res = await authedKalshi<{ order?: { order_id?: string; status?: string } }>(
        { keyId, pem },
        "POST",
        "/portfolio/orders",
        body,
      );
      return {
        ok: true as const,
        orderId: res.order?.order_id ?? null,
        status: res.order?.status ?? "submitted",
      };
    } catch (e) {
      console.error("Kalshi order failed", e);
      return { ok: false as const, error: e instanceof Error ? e.message : "Order rejected" };
    }
  });