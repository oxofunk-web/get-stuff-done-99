export const GATE_SECS = 600; // trade window opens at the 10:00 mark (5 min before settle)
export const CLOSE_SECS = 840; // 14:00 — closing zone, no new entries
export const THRESHOLD = 86; // minimum confidence to fire
export const MAX_TRADES_PER_CANDLE = 4; // up to one trade per pair per 15m candle
export const MAX_SLIPPAGE_CENTS = 3; // never pay more than 3c above the scored price
export const DAILY_LOSS_CAP_DEFAULT = 20; // stop trading after this much loss in a day
export const LAG_PCT = 0.0012; // 0.12% BRTI vs Kalshi divergence
export const KALSHI_POLL_MS = 8000;

/** Quality filters — a signal must clear all of these before it can fire. */
export const MAX_SPREAD = 0.05; // skip illiquid books wider than 5¢
export const MIN_YES_MID = 0.12; // skip lottery-ticket longshots
export const MAX_YES_MID = 0.9; // skip near-certain, no edge left
export const MIN_SKEW = 0.04; // book must lean at least 4¢ one way
export const MIN_TICKS = 24; // enough spot history to trust momentum
/** Minimum expected value per dollar risked — kills "95% read at 92¢" trades. */
export const EV_MARGIN = 0.08;
/** Minimum cushion between spot and strike, in standard deviations of movement. */
export const MIN_SIGMA_DIST = 0.55;

export type PairId = "BTC" | "ETH" | "SOL" | "XRP" | "BNB" | "NEAR" | "DOGE";

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
  {
    id: "BNB",
    name: "BNB",
    series: "KXBNB15M",
    wsKey: "bnbusdt",
    colorClass: "text-bnb",
    colorVar: "var(--color-bnb)",
  },
  {
    id: "NEAR",
    name: "NEAR",
    series: "KXNEAR15M",
    wsKey: "nearusdt",
    colorClass: "text-near",
    colorVar: "var(--color-near)",
  },
  {
    id: "DOGE",
    name: "Dogecoin",
    series: "KXDOGE15M",
    wsKey: "dogeusdt",
    colorClass: "text-doge",
    colorVar: "var(--color-doge)",
  },
];

export const WS_URL =
  "wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/solusdt@ticker/xrpusdt@ticker/bnbusdt@ticker/nearusdt@ticker/dogeusdt@ticker";

export const WS_MAP: Record<string, PairId> = {
  btcusdt: "BTC",
  ethusdt: "ETH",
  solusdt: "SOL",
  xrpusdt: "XRP",
  bnbusdt: "BNB",
  nearusdt: "NEAR",
  dogeusdt: "DOGE",
};

/**
 * Coinbase Exchange feed — an actual BRTI constituent and reachable from US
 * mobile networks where Binance is geo-blocked. Used as the primary source.
 */
export const CB_WS_URL = "wss://ws-feed.exchange.coinbase.com";

export const CB_PRODUCTS = [
  "BTC-USD",
  "ETH-USD",
  "SOL-USD",
  "XRP-USD",
  "BNB-USD",
  "NEAR-USD",
  "DOGE-USD",
] as const;

export const CB_MAP: Record<string, PairId> = {
  "BTC-USD": "BTC",
  "ETH-USD": "ETH",
  "SOL-USD": "SOL",
  "XRP-USD": "XRP",
  "BNB-USD": "BNB",
  "NEAR-USD": "NEAR",
  "DOGE-USD": "DOGE",
};

/** How long to wait for a first frame before failing over to the next source. */
export const FEED_TIMEOUT_MS = 5000;
/** Server-polled REST fallback cadence when both sockets are blocked. */
export const REST_POLL_MS = 1000;