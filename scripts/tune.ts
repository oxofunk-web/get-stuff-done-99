/**
 * Real-data threshold tuner.
 *
 *   bun scripts/tune.ts --hours 24
 *
 * Pulls real Coinbase 1-minute candles for every traded pair, expands them into
 * per-15s frames with synthetic-but-realistic Kalshi books priced off distance
 * to the strike, then sweeps the signal filters through the existing backtest
 * harness and prints the grid sorted by ROI.
 */
import { CB_PRODUCTS } from "../src/lib/bot/constants";
import type { PairId } from "../src/lib/bot/constants";
import { runBacktest, type BacktestFrame } from "../src/lib/bot/backtest";
import { setSignalDebug } from "../src/lib/bot/signals";
import { setTuning, resetTuning } from "../src/lib/bot/tuning";

const args = process.argv.slice(2);
const num = (flag: string, fallback: number) => {
  const i = args.indexOf(`--${flag}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

setSignalDebug(false);

const HOURS = num("hours", 24);
const STEP_MS = 15000;

const MAP: Record<string, PairId> = {
  "BTC-USD": "BTC",
  "ETH-USD": "ETH",
  "SOL-USD": "SOL",
  "XRP-USD": "XRP",
};

interface Candle {
  ts: number;
  close: number;
}

async function fetchCandles(product: string): Promise<Candle[]> {
  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - HOURS * 3600;
  const out: Candle[] = [];
  // Coinbase caps a candle request at 300 buckets and wants ISO timestamps.
  for (let from = startSec; from < endSec; from += 300 * 60) {
    const to = Math.min(endSec, from + 300 * 60);
    const url =
      `https://api.exchange.coinbase.com/products/${product}/candles` +
      `?granularity=60&start=${new Date(from * 1000).toISOString()}&end=${new Date(to * 1000).toISOString()}`;
    const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "kalshi-bot-tuner" } });
    if (!r.ok) throw new Error(`${product} ${r.status} ${(await r.text()).slice(0, 120)}`);
    const rows = (await r.json()) as number[][];
    for (const row of rows) out.push({ ts: row[0]! * 1000, close: row[4]! });
    await new Promise((res) => setTimeout(res, 250));
  }
  const seen = new Set<number>();
  return out
    .filter((c) => (seen.has(c.ts) ? false : (seen.add(c.ts), true)))
    .sort((a, b) => a.ts - b.ts);
}

function buildFrames(series: Partial<Record<PairId, Candle[]>>): BacktestFrame[] {
  const pairs = Object.keys(series) as PairId[];
  const first = series[pairs[0]!]!;
  const startTs = Math.ceil(first[0]!.ts / 900000) * 900000;
  const endTs = first[first.length - 1]!.ts;
  const idx: Partial<Record<PairId, number>> = {};
  const strike: Partial<Record<PairId, number>> = {};
  const frames: BacktestFrame[] = [];

  const priceAt = (pair: PairId, ts: number) => {
    const rows = series[pair]!;
    let i = idx[pair] ?? 0;
    while (i + 1 < rows.length && rows[i + 1]!.ts <= ts) i += 1;
    idx[pair] = i;
    const a = rows[i]!;
    const b = rows[Math.min(i + 1, rows.length - 1)]!;
    const span = Math.max(1, b.ts - a.ts);
    const t = Math.min(1, Math.max(0, (ts - a.ts) / span));
    return a.close + (b.close - a.close) * t;
  };

  for (let ts = startTs; ts <= endTs; ts += STEP_MS) {
    const inCandle = ts % 900000;
    const spot: BacktestFrame["spot"] = {};
    const markets: BacktestFrame["markets"] = {};
    for (const pair of pairs) {
      const price = priceAt(pair, ts);
      if (inCandle === 0 || strike[pair] == null) strike[pair] = price;
      const k = strike[pair]!;
      const edge = (price - k) / k;
      // Books get sharper as settlement approaches, like the real thing.
      const gain = 60 + (inCandle / 900000) * 140;
      const yesMid = Math.min(0.97, Math.max(0.03, 0.5 + edge * gain));
      const half = 0.01 + (yesMid > 0.9 || yesMid < 0.1 ? 0.015 : 0);
      spot[pair] = { price };
      markets[pair] = {
        pair,
        ticker: `${pair}-REAL`,
        strike: k,
        yesBid: Math.max(0.01, yesMid - half),
        yesAsk: Math.min(0.99, yesMid + half),
        noBid: Math.max(0.01, 1 - yesMid - half),
        noAsk: Math.min(0.99, 1 - yesMid + half),
        yesMid,
        spread: half * 2,
        vol: 5000,
        closeTime: null,
      };
    }
    frames.push({ ts, spot, markets });
  }
  return frames;
}

const series: Partial<Record<PairId, Candle[]>> = {};
for (const product of CB_PRODUCTS) {
  try {
    series[MAP[product]!] = await fetchCandles(product);
  } catch (e) {
    console.warn(`skip ${product}:`, e instanceof Error ? e.message : e);
  }
}
if (!Object.keys(series).length) {
  console.error("no candle data available");
  process.exit(1);
}
const frames = buildFrames(series);
console.log(`frames=${frames.length} pairs=${Object.keys(series).join(",")} hours=${HOURS}`);

const grid: { threshold: number; minSkew: number; gateSecs: number; maxSpread: number }[] = [];
for (const threshold of [80, 84, 86, 90, 93]) {
  for (const minSkew of [0.04, 0.08, 0.12]) {
    for (const gateSecs of [480, 600, 720]) {
      for (const maxSpread of [0.03, 0.05]) {
        grid.push({ threshold, minSkew, gateSecs, maxSpread });
      }
    }
  }
}

const rows = grid.map((g) => {
  resetTuning();
  setTuning(g);
  const r = runBacktest(frames, { betSize: 5, slippageCents: 2 });
  return { ...g, trades: r.trades.length, winRate: r.winRate, pnl: r.pnl, roi: r.roi };
});
resetTuning();

rows
  .filter((r) => r.trades >= 8)
  .sort((a, b) => b.roi - a.roi)
  .slice(0, 15)
  .forEach((r) => {
    console.log(
      `thr=${r.threshold} skew=${r.minSkew} gate=${r.gateSecs} spread=${r.maxSpread} → trades=${r.trades} win=${r.winRate.toFixed(1)}% pnl=$${r.pnl.toFixed(2)} roi=${r.roi.toFixed(1)}%`,
    );
  });
