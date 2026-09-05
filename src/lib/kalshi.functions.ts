import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { PAIRS } from "./bot/constants";
import {
  fetchLiveBalance,
  fetchOpenMarketWithReason,
  fetchPortfolioSnapshot,
  normalizeMarket,
  placeLiveOrder,
} from "./kalshi.server";

const RETRY_DELAYS_MS = [400, 1000];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Live YES/NO orderbook for every 15-minute crypto series. Public data.
 * Spot prices are optional but strongly recommended: each candle lists many
 * strikes and only the one nearest spot is tradable.
 *
 * A single flaky read used to drop a pair silently. Each pair now gets two
 * extra attempts and, if it still fails, reports a short reason so the
 * dashboard can show a real error instead of a blank row.
 */
export const getMarkets = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.record(z.string(), z.number()).optional().parse(input) ?? {})
  .handler(async ({ data }) => {
    const results = await Promise.all(
      PAIRS.map(async (p) => {
        let error: string | null = null;
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
          if (attempt > 0) await wait(RETRY_DELAYS_MS[attempt - 1]!);
          const res = await fetchOpenMarketWithReason(p.series, data[p.id] ?? null);
          if (res.market) return { pair: p.id, market: { pair: p.id, ...normalizeMarket(res.market) } };
          error = res.error;
          // A period with no contract at all will not appear on a retry either.
          if (res.error?.startsWith("no contract")) break;
        }
        return { pair: p.id, error: error ?? "unavailable" };
      }),
    );
    const markets = results
      .map((r) => ("market" in r ? r.market : null))
      .filter((m): m is NonNullable<typeof m> => m != null);
    const failures = results.flatMap((r) =>
      "error" in r && r.error ? [{ pair: r.pair as string, error: r.error }] : [],
    );

    return {
      markets,
      failures,
      ok: markets.length > 0,
      error: markets.length === 0 ? (failures[0]?.error ?? "Kalshi unreachable") : null,
      ts: Date.now(),
    };
  });


/** Whether live trading credentials are configured on the server. */
export const getLiveStatus = createServerFn({ method: "GET" }).handler(async () => {
  const keyId = process.env["KALSHI_API_KEY_ID"];
  const pem = process.env["KALSHI_PRIVATE_KEY"];
  if (!keyId || !pem) return { configured: false, balance: null as number | null, error: null };
  try {
    const balance = await fetchLiveBalance({ keyId, pem });
    return {
      configured: true,
      balance,
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

/** Places a real IOC limit order on Kalshi, capped by a hard slippage ceiling. */
export const placeOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        ticker: z.string().min(3).max(80),
        side: z.enum(["yes", "no"]),
        priceCents: z.number().int().min(1).max(99),
        count: z.number().int().min(1).max(500),
        maxPriceCents: z.number().int().min(1).max(99).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const keyId = process.env["KALSHI_API_KEY_ID"];
    const pem = process.env["KALSHI_PRIVATE_KEY"];
    if (!keyId || !pem) {
      return { ok: false as const, error: "Live trading keys are not configured." };
    }
    return placeLiveOrder({ keyId, pem }, data);
  });

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
    const snapshot = await fetchPortfolioSnapshot({ keyId, pem });
    return {
      configured: true as const,
      ...snapshot,
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
