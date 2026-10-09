import { createServerFn } from "@tanstack/react-start";

import { PAIRS, type PairId } from "./bot/constants";

export interface Candle {
  /** Candle open time in ms. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

const CB_PRODUCT: Record<PairId, string> = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  XRP: "XRP-USD",
  EURUSD: "", GBPUSD: "", USDJPY: "", AUDUSD: "",
};

async function fromKraken(pair: PairId): Promise<Candle[]> {
  const res = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=15`);
  if (!res.ok) throw new Error(`kraken ${res.status}`);
  const j = (await res.json()) as { result?: Record<string, unknown> };
  const rows = (Object.entries(j.result ?? {}).find(([key]) => key !== "last")?.[1] ?? []) as (string | number)[][];
  return rows
    .map((r) => ({ t: Number(r[0]) * 1000, o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }))
    .filter((x) => x.t && x.o && x.c)
    .sort((a, b) => a.t - b.t);
}

const BINANCE_SYMBOL: Record<PairId, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  XRP: "XRPUSDT",
  EURUSD: "", GBPUSD: "", USDJPY: "", AUDUSD: "",
};

async function fromCoinbase(pair: PairId): Promise<Candle[]> {
  const res = await fetch(
    `https://api.exchange.coinbase.com/products/${CB_PRODUCT[pair]}/candles?granularity=900`,
    { headers: { "User-Agent": "coin-direction-reader" } },
  );
  if (!res.ok) throw new Error(`coinbase ${res.status}`);
  const rows = (await res.json()) as number[][];
  return rows
    .map((r) => ({ t: (r[0] ?? 0) * 1000, l: r[1] ?? 0, h: r[2] ?? 0, o: r[3] ?? 0, c: r[4] ?? 0 }))
    .filter((k) => k.t && k.o && k.c)
    .sort((a, b) => a.t - b.t);
}

async function fromBinance(pair: PairId): Promise<Candle[]> {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${BINANCE_SYMBOL[pair]}&interval=15m&limit=48`,
  );
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const rows = (await res.json()) as (string | number)[][];
  return rows
    .map((r) => ({
      t: Number(r[0] ?? 0),
      o: Number(r[1] ?? 0),
      h: Number(r[2] ?? 0),
      l: Number(r[3] ?? 0),
      c: Number(r[4] ?? 0),
    }))
    .filter((k) => k.t && k.o && k.c);
}

/**
 * Real 15-minute candles for every tracked coin, fetched server-side so the
 * chart works on networks that block exchange endpoints from the device.
 */
export const getCoinCandles = createServerFn({ method: "GET" }).handler(async () => {
  const entries = await Promise.all(
    PAIRS.map(async (p) => {
      if (!CB_PRODUCT[p.id]) {
        try {
          return [p.id, await fromKraken(p.id)] as const;
        } catch {
          return null;
        }
      }
      try {
        return [p.id, await fromCoinbase(p.id)] as const;
      } catch {
        try {
          return [p.id, await fromBinance(p.id)] as const;
        } catch {
          return null;
        }
      }
    }),
  );

  const candles: Partial<Record<PairId, Candle[]>> = {};
  for (const e of entries) if (e && e[1].length) candles[e[0]] = e[1].slice(-48);
  return { candles, ok: Object.keys(candles).length > 0, ts: Date.now() };
});
