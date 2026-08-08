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
      authedKalshi<{ balance: number }>({ keyId, pem }, "GET", "/portfolio/balance"),
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
      balance: bal.balance / 100,
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
