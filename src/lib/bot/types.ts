import type { PairId } from "./constants";

export interface SpotTick {
  price: number;
  ts: number;
}

export interface SpotState {
  price: number;
  prev: number;
  change24h: number;
  ts: number;
  ticks: SpotTick[];
}

export interface KalshiMarket {
  pair: PairId;
  ticker: string;
  strike: number | null;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  yesMid: number;
  spread: number;
  vol: number;
  /** Contracts resting at the YES ask / YES bid (NO ask depth = YES bid size). */
  yesAskSize: number;
  yesBidSize: number;
  closeTime: string | null;
}

export type LagState = "fire" | "warn" | "ok";

export interface Signal {
  id: string;
  pair: PairId;
  dir: "YES" | "NO";
  conf: number;
  yesMid: number;
  spread: number;
  spotMom: number;
  kMom: number;
  lagDetected: boolean;
  /** Calibrated win probability (0-1) after mapping conf onto real history. */
  calibrated: number;
  /** Price we expect to pay per contract, including half the spread. */
  entry: number;
  /** Expected value per dollar risked at that entry. */
  ev: number;
  /** Distance from spot to strike in standard deviations of recent movement. */
  sigmaDist: number;
  /** Book lean: yesMid - 0.5. */
  skew: number;
  reason: string;

  elapsed: number;
  remain: number;
}

export type TradeStatus = "pending" | "placed" | "failed";

export interface TradeLogEntry {
  id: string;
  time: string;
  pair: PairId;
  dir: "YES" | "NO";
  conf: number;
  status: TradeStatus;
  msg: string;
  /** Set when the runner closed the position early (take profit / stop out). */
  exitReason?: string | null;
  pnl?: number | null;
}

export interface OrderResult {
  paper: boolean;
  orderId?: string;
  status?: string;
  contracts?: number;
  priceCents?: number;
  error?: string;
}