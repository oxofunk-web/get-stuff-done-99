import { candleInfo } from "./candle";
import { MAX_TRADES_PER_CANDLE, PAIRS, type PairId } from "./constants";
import { computeSignals } from "./signals";
import type { KalshiMarket, SpotState } from "./types";

/**
 * A single second of replayable market state. Feed a sequence of these to
 * `runBacktest` to replay the live decision path (computeSignals → fill →
 * settle) offline, with zero network and zero real money.
 */
export interface BacktestFrame {
  ts: number;
  spot: Partial<Record<PairId, { price: number }>>;
  markets: Partial<Record<PairId, KalshiMarket>>;
}

export interface BacktestOptions {
  betSize?: number;
  /** Extra cents paid over the ask to model crossing the touch. */
  slippageCents?: number;
  maxTradesPerCandle?: number;
}

export interface BacktestTrade {
  candleId: number;
  ts: number;
  pair: PairId;
  dir: "YES" | "NO";
  conf: number;
  entryCents: number;
  count: number;
  stake: number;
  settleSpot: number;
  strike: number | null;
  won: boolean;
  pnl: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  candles: number;
  signals: number;
  wins: number;
  losses: number;
  winRate: number;
  staked: number;
  pnl: number;
  roi: number;
  perPair: Record<string, { trades: number; wins: number; pnl: number }>;
}

const TICK_WINDOW = 120;

function pushTick(state: SpotState | undefined, price: number, ts: number): SpotState {
  const ticks = [...(state?.ticks ?? []), { price, ts }].slice(-TICK_WINDOW);
  return {
    price,
    prev: state?.price ?? price,
    change24h: state?.change24h ?? 0,
    ts,
    ticks,
  };
}

/** YES settles true when spot finishes at or above the strike. */
function yesWins(settleSpot: number, strike: number | null) {
  if (strike == null) return null;
  return settleSpot >= strike;
}

export function runBacktest(frames: BacktestFrame[], options: BacktestOptions = {}): BacktestResult {
  const betSize = options.betSize ?? 5;
  const slippage = options.slippageCents ?? 2;
  const maxTrades = options.maxTradesPerCandle ?? MAX_TRADES_PER_CANDLE;

  const spotState: Partial<Record<PairId, SpotState>> = {};
  const history: Partial<Record<PairId, number[]>> = {};

  let candleId = frames.length ? candleInfo(frames[0]!.ts).id : 0;
  let tradesThisCandle = 0;
  let pairsThisCandle = new Set<PairId>();
  let signals = 0;
  let candles = 0;

  interface OpenTrade extends Omit<BacktestTrade, "settleSpot" | "won" | "pnl"> {}
  let openTrades: OpenTrade[] = [];
  const trades: BacktestTrade[] = [];

  const settle = (frame: BacktestFrame | undefined) => {
    for (const t of openTrades) {
      const settleSpot = frame?.spot[t.pair]?.price ?? spotState[t.pair]?.price ?? 0;
      const yes = yesWins(settleSpot, t.strike);
      const won = yes == null ? false : t.dir === "YES" ? yes : !yes;
      const entry = t.entryCents / 100;
      trades.push({
        ...t,
        settleSpot,
        won,
        pnl: won ? t.count * (1 - entry) : -t.count * entry,
      });
    }
    openTrades = [];
  };

  for (const frame of frames) {
    const info = candleInfo(frame.ts);
    if (info.id !== candleId) {
      settle(frame);
      candleId = info.id;
      candles += 1;
      tradesThisCandle = 0;
      pairsThisCandle = new Set();
    }

    for (const p of PAIRS) {
      const price = frame.spot[p.id]?.price;
      if (price == null) continue;
      spotState[p.id] = pushTick(spotState[p.id], price, frame.ts);
      const m = frame.markets[p.id];
      if (m) {
        const h = history[p.id] ?? [];
        h.push(m.yesMid);
        if (h.length > 40) h.shift();
        history[p.id] = h;
      }
    }

    const sigs = computeSignals(spotState, frame.markets, history, frame.ts);
    signals += sigs.length;

    for (const sig of sigs) {
      if (tradesThisCandle >= maxTrades) break;
      if (pairsThisCandle.has(sig.pair)) continue;
      const m = frame.markets[sig.pair];
      if (!m) continue;
      const ask = sig.dir === "YES" ? m.yesAsk : m.noAsk;
      const entryCents = Math.min(99, Math.max(1, Math.round(ask * 100) + slippage));
      const count = Math.max(1, Math.floor(betSize / (entryCents / 100)));
      openTrades.push({
        candleId,
        ts: frame.ts,
        pair: sig.pair,
        dir: sig.dir,
        conf: sig.conf,
        entryCents,
        count,
        stake: (count * entryCents) / 100,
        strike: m.strike,
      });
      tradesThisCandle += 1;
      pairsThisCandle.add(sig.pair);
    }
  }

  settle(frames[frames.length - 1]);

  const wins = trades.filter((t) => t.won).length;
  const staked = trades.reduce((a, t) => a + t.stake, 0);
  const pnl = trades.reduce((a, t) => a + t.pnl, 0);
  const perPair: BacktestResult["perPair"] = {};
  for (const t of trades) {
    const row = (perPair[t.pair] ??= { trades: 0, wins: 0, pnl: 0 });
    row.trades += 1;
    row.wins += t.won ? 1 : 0;
    row.pnl += t.pnl;
  }

  return {
    trades,
    candles: candles + 1,
    signals,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    staked,
    pnl,
    roi: staked ? (pnl / staked) * 100 : 0,
    perPair,
  };
}

/** Deterministic pseudo-random walk generator for repeatable scenarios. */
export function makeSyntheticFrames(opts: {
  pairs?: PairId[];
  candles?: number;
  startPrice?: number;
  drift?: number;
  vol?: number;
  seed?: number;
  startTs?: number;
}): BacktestFrame[] {
  const pairs = opts.pairs ?? ["BTC"];
  const candles = opts.candles ?? 4;
  const drift = opts.drift ?? 0;
  const vol = opts.vol ?? 0.0004;
  let seed = opts.seed ?? 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const startTs = opts.startTs ?? Math.floor(Date.now() / 900000) * 900000;
  const price: Record<string, number> = {};
  const strike: Record<string, number> = {};
  for (const p of pairs) price[p] = opts.startPrice ?? 60000;
  const at = (r: Record<string, number>, k: string) => r[k] ?? 0;

  const frames: BacktestFrame[] = [];
  for (let c = 0; c < candles; c += 1) {
    for (const p of pairs) strike[p] = at(price, p);
    for (let s = 0; s < 900; s += 1) {
      const ts = startTs + c * 900000 + s * 1000;
      const spot: BacktestFrame["spot"] = {};
      const markets: BacktestFrame["markets"] = {};
      for (const p of pairs) {
        const next = at(price, p) * (1 + drift + (rand() - 0.5) * 2 * vol);
        price[p] = next;
        const k = at(strike, p);
        spot[p] = { price: next };
        const edge = (next - k) / k;
        const yesMid = Math.min(0.97, Math.max(0.03, 0.5 + edge * 90));
        const half = 0.01;
        markets[p] = {
          pair: p,
          ticker: `${p}-TEST`,
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
  }
  return frames;
}

export function formatBacktest(r: BacktestResult) {
  const lines = [
    `candles=${r.candles} signals=${r.signals} trades=${r.trades.length}`,
    `wins=${r.wins} losses=${r.losses} winRate=${r.winRate.toFixed(1)}%`,
    `staked=$${r.staked.toFixed(2)} pnl=$${r.pnl.toFixed(2)} roi=${r.roi.toFixed(1)}%`,
  ];
  for (const [pair, row] of Object.entries(r.perPair)) {
    lines.push(`  ${pair}: ${row.trades} trades, ${row.wins} wins, $${row.pnl.toFixed(2)}`);
  }
  return lines.join("\n");
}
