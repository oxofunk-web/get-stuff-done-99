export const GATE_SECS = 600; // trade window opens at the 10:00 mark
export const CLOSE_SECS = 840; // 14:00 — closing zone, no new entries
export const THRESHOLD = 80; // minimum confidence to fire
export const LAG_PCT = 0.0012; // 0.12% BRTI vs Kalshi divergence
export const KALSHI_POLL_MS = 8000;

export type PairId = "BTC" | "ETH" | "SOL" | "XRP";

export interface Pair {
  id: PairId;
  name: string;
  series: string;
  wsKey: string;
  colorClass: string;
  colorVar: string;
}

export const PAIRS: Pair[] = [
  {
    id: "BTC",
    name: "Bitcoin",
    series: "KXBTC15M",
    wsKey: "btcusdt",
    colorClass: "text-btc",
    colorVar: "var(--color-btc)",
  },
  {
    id: "ETH",
    name: "Ethereum",
    series: "KXETH15M",
    wsKey: "ethusdt",
    colorClass: "text-eth",
    colorVar: "var(--color-eth)",
  },
  {
    id: "SOL",
    name: "Solana",
    series: "KXSOL15M",
    wsKey: "solusdt",
    colorClass: "text-sol",
    colorVar: "var(--color-sol)",
  },
  {
    id: "XRP",
    name: "XRP",
    series: "KXXRP15M",
    wsKey: "xrpusdt",
    colorClass: "text-xrp",
    colorVar: "var(--color-xrp)",
  },
];

export const WS_URL =
  "wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/solusdt@ticker/xrpusdt@ticker";

export const WS_MAP: Record<string, PairId> = {
  btcusdt: "BTC",
  ethusdt: "ETH",
  solusdt: "SOL",
  xrpusdt: "XRP",
};