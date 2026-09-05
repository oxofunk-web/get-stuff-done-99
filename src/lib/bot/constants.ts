export const GATE_SECS = 600; // trade window opens at the 10:00 mark (5 min before settle)
export const CLOSE_SECS = 840; // 14:00 — closing zone, no new entries
export const THRESHOLD = 72; // minimum score to fire (BALANCED preset, de-saturated curve)
export const MAX_TRADES_PER_CANDLE = 4; // up to one trade per pair per 15m candle
export const MAX_SLIPPAGE_CENTS = 3; // floor for the value-based slippage cap
/**
 * Absolute ceiling on chasing, in cents above the scored price. The real cap is
 * value-based (pay up to where EV falls under the margin); this stops a very
 * high-confidence read from turning into an unbounded chase.
 */
export const MAX_CHASE_CENTS = 8;
/** Order attempts allowed per pair per candle (one retry after a moved quote). */
export const MAX_ORDER_ATTEMPTS = 1;
/** Separates evidence gathered under materially different decision rules. */
export const STRATEGY_VERSION = "stable-v2";
export const DAILY_LOSS_CAP_DEFAULT = 20; // stop trading after this much loss in a day
/**
 * Minimum contracts resting at the touch before an order is worth sending.
 * Thin books ate 119 of 147 live attempts; below this we skip the pair for the
 * candle instead of logging another failure.
 */
export const MIN_RESTING_DEPTH = 2;
export const LAG_PCT = 0.0012; // 0.12% BRTI vs Kalshi divergence
export const KALSHI_POLL_MS = 8000;

/**
 * Quality filters — a signal must clear all of these before it can fire.
 * These are the BALANCED preset: strict enough to skip junk books, loose
 * enough that well-priced favourites are not thrown away. The dashboard can
 * override every one of them (STRICT / BALANCED / AGGRESSIVE).
 */
export const MAX_SPREAD = 0.07; // skip illiquid books wider than 7¢
export const MIN_YES_MID = 0.08; // skip lottery-ticket longshots
export const MAX_YES_MID = 0.94; // skip near-certain, no edge left
export const MIN_SKEW = 0.02; // book must lean at least 2¢ one way
export const MIN_TICKS = 24; // enough spot history to trust momentum
/** Minimum expected value per dollar risked — kills "95% read at 92¢" trades. */
export const EV_MARGIN = 0.04;
/** Minimum cushion between spot and strike, in standard deviations of movement. */
export const MIN_SIGMA_DIST = 0.35;
/**
 * Upper end of the cushion band. Beyond this the contract is a near-certainty
 * the book has already priced: 23 of 248 recorded live reads sat past 3σ and
 * were bought at 78¢ average, where one miss erases several wins.
 */
export const MAX_SIGMA_DIST = 3.0;
/** Cushion (in sigma) where the score peaks before decaying toward the band edge. */
export const CUSHION_PEAK_SIGMA = 1.5;
/** Highest price per contract the engine will pay for the leg it buys. */
export const MAX_ENTRY_PRICE = 0.8;
/** Score curve: 50 + SPAN * strength/(strength + HALF) — soft, never saturates. */
export const SCORE_SPAN = 45;
export const SCORE_HALF = 0.45;
/** Asymptote of the raw curve — the score approaches but never reaches it. */
export const SCORE_ASYMPTOTE = 50 + SCORE_SPAN;
/** Display ceilings so a raw score can never be shown as a certainty. */
export const SCORE_CAP_PROVEN = 95;
export const SCORE_CAP_UNPROVEN = 90;
/**
 * Highest value the minimum-confidence dial may be set to. A dial above what
 * the curve can reach is a dead zone where nothing can ever fire — that is
 * exactly what an 88 setting did against a 90 display ceiling.
 */
export const SCORE_DIAL_MAX = SCORE_CAP_UNPROVEN - 4;

/**
 * Compress the raw score into the band its evidence earns, WITHOUT clamping:
 * a hard Math.min collapsed every strong read onto the same number, which is
 * the saturation problem all over again. This keeps every read distinct.
 */
export function displayScore(raw: number, calibrationReady: boolean) {
  const cap = calibrationReady ? SCORE_CAP_PROVEN : SCORE_CAP_UNPROVEN;
  const t = Math.max(0, Math.min(1, (raw - 50) / (SCORE_ASYMPTOTE - 50)));
  return 50 + (cap - 50) * t;
}



/** Gate presets exposed on the dashboard. */
export interface GatePreset {
  threshold: number;
  evMargin: number;
  minYesMid: number;
  maxYesMid: number;
  minSkew: number;
  maxSpread: number;
  minSigmaDist: number;
}

export const GATE_PRESETS: Record<"strict" | "balanced" | "aggressive", GatePreset> = {
  strict: {
    threshold: 78,
    evMargin: 0.08,
    minYesMid: 0.12,
    maxYesMid: 0.9,
    minSkew: 0.04,
    maxSpread: 0.05,
    minSigmaDist: 0.55,
  },
  balanced: {
    threshold: 72,
    evMargin: 0.04,
    minYesMid: 0.08,
    maxYesMid: 0.94,
    minSkew: 0.02,
    maxSpread: 0.07,
    minSigmaDist: 0.35,
  },
  aggressive: {
    threshold: 66,
    evMargin: 0.02,
    minYesMid: 0.05,
    maxYesMid: 0.97,
    minSkew: 0.01,
    maxSpread: 0.09,
    minSigmaDist: 0.2,
  },
};

export type GatePresetName = keyof typeof GATE_PRESETS;

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