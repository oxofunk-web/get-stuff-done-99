import { createServerFn } from "@tanstack/react-start";

import { CB_MAP, CB_PRODUCTS, type PairId } from "./bot/constants";

/**
 * Server-side spot fallback. Runs on our server, so it works on any network
 * that blocks exchange endpoints from the device (US mobile carriers, Binance
 * geo-blocks, corporate wifi). Coinbase is a BRTI constituent exchange.
 */
export const getSpotPrices = createServerFn({ method: "GET" }).handler(async () => {
  const entries = await Promise.all(
    CB_PRODUCTS.map(async (product) => {
      try {
        const res = await fetch(
          `https://api.exchange.coinbase.com/products/${product}/ticker`,
          { headers: { "User-Agent": "kalshi-15m-bot" } },
        );
        if (!res.ok) return null;
        const j = (await res.json()) as { price?: string; open_24h?: string };
        const price = Number(j.price ?? 0);
        if (!price) return null;
        const statsRes = await fetch(
          `https://api.exchange.coinbase.com/products/${product}/stats`,
          { headers: { "User-Agent": "kalshi-15m-bot" } },
        );
        const stats = statsRes.ok ? ((await statsRes.json()) as { open?: string }) : {};
        const open = Number(stats.open ?? j.open_24h ?? 0);
        const change24h = open > 0 ? ((price - open) / open) * 100 : 0;
        return [CB_MAP[product] as PairId, { price, change24h }] as const;
      } catch {
        return null;
      }
    }),
  );

  const prices: Partial<Record<PairId, { price: number; change24h: number }>> = {};
  for (const e of entries) if (e) prices[e[0]] = e[1];
  return { prices, ok: Object.keys(prices).length > 0, ts: Date.now() };
});