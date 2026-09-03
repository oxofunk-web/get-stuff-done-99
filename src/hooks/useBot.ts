import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBrtiFeed } from "./useBrtiFeed";
import { candleInfo } from "@/lib/bot/candle";
import {
  KALSHI_POLL_MS,
  DAILY_LOSS_CAP_DEFAULT,
  MAX_TRADES_PER_CANDLE,
  PAIRS,
  type PairId,
  MAX_SLIPPAGE_CENTS,
} from "@/lib/bot/constants";
import { computeSignals, getSignalTrace, setCalibration } from "@/lib/bot/signals";
import { rankSignals, setPairEdge } from "@/lib/bot/ranking";
import { getTuning, setTuning } from "@/lib/bot/tuning";
import {
  getAccuracy,
  getRejectionReport,
  recordSignals,
  recordSnapshots,
  recordTrade,
  settleCandle,
  type AccuracyStats,
  type RejectionRow,
} from "@/lib/bot/telemetry.functions";

import type { KalshiMarket, Signal, TradeLogEntry, TradeStatus } from "@/lib/bot/types";
import { getLiveStatus, getMarkets, getPortfolio, placeOrder } from "@/lib/kalshi.functions";


export type Mode = "paper" | "live";

export interface Toast {
  id: number;
  msg: string;
  tone: "yes" | "no" | "warn";
}

export interface OpenPosition {
  id: string;
  pair: PairId;
  dir: "YES" | "NO";
  count: number;
  entry: number; // dollars per contract
  stake: number;
  candleId: number;
  paper: boolean;
}

export interface Portfolio {
  configured: boolean;
  balance: number | null;
  realized: number;
  exposure: number;
  positions: { ticker: string; count: number; exposure: number; realized: number }[];
  error: string | null;
}

export function useBot() {
  const { spot, status: feedStatus, source: feedSource, tick } = useBrtiFeed();

  const [markets, setMarkets] = useState<Partial<Record<PairId, KalshiMarket>>>({});
  const [marketsOk, setMarketsOk] = useState<boolean | null>(null);
  const historyRef = useRef<Partial<Record<PairId, number[]>>>({});
  const marketsRef = useRef<Partial<Record<PairId, KalshiMarket>>>({});

  const [mode, setMode] = useState<Mode>("paper");
  const [botOn, setBotOn] = useState(false);
  const [betSize, setBetSize] = useState(5);
  const [dailyLossCap, setDailyLossCap] = useState(DAILY_LOSS_CAP_DEFAULT);
  const [capHit, setCapHit] = useState(false);
  const dayRef = useRef<{ day: string; base: number }>({ day: "", base: 0 });
  const armedRef = useRef(false);
  const [placedCount, setPlacedCount] = useState(0);
  const [exposure, setExposure] = useState(0);
  const [sigCount, setSigCount] = useState(0);
  const [log, setLog] = useState<TradeLogEntry[]>([]);
  const [lastTrade, setLastTrade] = useState<{ label: string; time: string } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [tradeStatus, setTradeStatus] = useState<Record<string, { status: TradeStatus; msg: string }>>({});
  const [live, setLive] = useState<{ configured: boolean; balance: number | null; error: string | null }>({
    configured: false,
    balance: null,
    error: null,
  });
  const [portfolio, setPortfolio] = useState<Portfolio>({
    configured: false,
    balance: null,
    realized: 0,
    exposure: 0,
    positions: [],
    error: null,
  });
  const [open, setOpen] = useState<OpenPosition[]>([]);
  const [realizedPaper, setRealizedPaper] = useState(0);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);

  const [now, setNow] = useState(() => Date.now());
  const candle = candleInfo(now);
  const candleRef = useRef(candle.id);
  const tradesRef = useRef(0);
  const tradedPairsRef = useRef<Set<string>>(new Set());
  const firingRef = useRef(false);
  const seenSigIds = useRef<Set<string>>(new Set());
  const [tradedThisCandle, setTradedThisCandle] = useState(false);
  const [maxTrades, setMaxTrades] = useState(MAX_TRADES_PER_CANDLE);

  // ---- telemetry / accuracy -------------------------------------------------
  const [accuracy, setAccuracy] = useState<AccuracyStats | null>(null);
  const [rejections, setRejections] = useState<RejectionRow[]>([]);
  const [evMargin, setEvMarginState] = useState(getTuning().evMargin);
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const loggedSigRef = useRef<Set<string>>(new Set());

  const setEvMargin = useCallback((v: number) => {
    setEvMarginState(v);
    setTuning({ evMargin: v });
  }, []);

  const refreshAccuracy = useCallback(async () => {
    try {
      const res = await getAccuracy();
      setAccuracy(res);
      if (res.ok) {
        setCalibration(res.table, res.pairTable);
        // Selection uses the same measured per-pair record as the panel.
        setPairEdge(res.pairEdge);
      }
      // What the filters threw away, and whether those rejections were right.
      void getRejectionReport()
        .then((r) => setRejections(r.ok ? r.rows : []))
        .catch(() => undefined);
      return res;
    } catch {
      return null;
    }
  }, []);


  useEffect(() => {
    void refreshAccuracy();
    const i = setInterval(() => void refreshAccuracy(), 120000);
    return () => clearInterval(i);
  }, [refreshAccuracy]);



  const notify = useCallback((msg: string, tone: Toast["tone"] = "yes") => {
    setToast({ id: Date.now(), msg, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5500);
    return () => clearTimeout(t);
  }, [toast]);

  // Clock
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, []);

  // Candle rollover resets the one-trade-per-candle lock
  useEffect(() => {
    if (candle.id !== candleRef.current) {
      const closed = candleRef.current;
      candleRef.current = candle.id;
      tradesRef.current = 0;
      tradedPairsRef.current = new Set();
      setTradedThisCandle(false);
      setTradeStatus({});
      seenSigIds.current = new Set();
      loggedSigRef.current = new Set();

      // Grade the candle that just closed against the settlement spot, then
      // pull the refreshed accuracy so calibration keeps learning.
      const finals = PAIRS.map((p) => ({ pair: p.id, spot: spotRef.current[p.id]?.price ?? 0 })).filter(
        (f) => f.spot > 0,
      );
      if (finals.length) {
        void settleCandle({ data: { candleId: closed, finals } })
          .then(() => refreshAccuracy())
          .catch(() => undefined);
      }

      // Settle every position that belonged to the candle that just closed.

      setOpen((list) => {
        const expired = list.filter((p) => p.candleId === closed);
        if (expired.length) {
          let pnl = 0;
          let w = 0;
          let l = 0;
          for (const p of expired) {
            const mid = marketsRef.current[p.pair]?.yesMid ?? 0.5;
            const finalProb = p.dir === "YES" ? mid : 1 - mid;
            const won = finalProb >= 0.5;
            pnl += won ? p.count * (1 - p.entry) : -p.count * p.entry;
            if (won) w += 1;
            else l += 1;
          }
          setRealizedPaper((r) => r + pnl);
          setWins((x) => x + w);
          setLosses((x) => x + l);
          setExposure((e) => Math.max(0, e - expired.reduce((a, p) => a + p.stake, 0)));
        }
        return list.filter((p) => p.candleId !== closed);
      });
    }
  }, [candle.id, refreshAccuracy]);

  // Kalshi orderbook polling (through the server, so no CORS and no key in the browser)
  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const res = await getMarkets();
        if (stop) return;
        const next: Partial<Record<PairId, KalshiMarket>> = {};
        for (const m of res.markets) {
          next[m.pair as PairId] = m as KalshiMarket;
          const h = historyRef.current[m.pair as PairId] ?? [];
          h.push(m.yesMid);
          if (h.length > 40) h.shift();
          historyRef.current[m.pair as PairId] = h;
        }
        setMarkets(next);
        marketsRef.current = next;
        setMarketsOk(res.ok);
      } catch {
        if (!stop) setMarketsOk(false);
      }
    };
    void pull();
    const i = setInterval(pull, KALSHI_POLL_MS);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, []);

  // Live-credential probe
  const refreshLive = useCallback(async () => {
    try {
      const res = await getLiveStatus();
      setLive(res);
      return res;
    } catch {
      const fallback = { configured: false, balance: null, error: "Could not reach Kalshi" };
      setLive(fallback);
      return fallback;
    }
  }, []);

  useEffect(() => {
    void refreshLive();
  }, [refreshLive]);

  // Wallet balance + realized P&L from the Kalshi account, once keys exist.
  const refreshPortfolio = useCallback(async () => {
    try {
      const res = await getPortfolio();
      setPortfolio(res);
      // Anchor today's realized P&L the first time we read the account so the
      // loss cap measures today's damage, not lifetime results.
      const day = new Date().toDateString();
      if (dayRef.current.day !== day) dayRef.current = { day, base: res.realized };
      return res;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshPortfolio();
    const i = setInterval(() => void refreshPortfolio(), 20000);
    return () => clearInterval(i);
  }, [refreshPortfolio]);

  const signals = useMemo(
    () => computeSignals(spot, markets, historyRef.current, now),
    // `tick` forces recompute as websocket ticks mutate the spot ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markets, now, tick],
  );

  // Count brand-new signals
  useEffect(() => {
    const fresh = signals.filter((s) => !seenSigIds.current.has(s.id));
    if (!fresh.length) return;
    fresh.forEach((s) => seenSigIds.current.add(s.id));
    setSigCount((c) => c + fresh.length);
  }, [signals]);

  // Market tape recorder — one batched write every 5s, not one per tick.
  useEffect(() => {
    const push = () => {
      const c = candleInfo(Date.now());
      const rows = PAIRS.map((p) => {
        const s = spotRef.current[p.id];
        const m = marketsRef.current[p.id];
        if (!s?.price) return null;
        return {
          candle_id: c.id,
          seconds_in: c.elapsed,
          pair: p.id as string,
          ticker: m?.ticker ?? null,
          spot: s.price,
          strike: m?.strike ?? null,
          yes_bid: m?.yesBid ?? null,
          yes_ask: m?.yesAsk ?? null,
          yes_mid: m?.yesMid ?? null,
          spread: m?.spread ?? null,
          vol: m?.vol ?? null,
        };
      }).filter((r): r is NonNullable<typeof r> => r !== null);
      if (rows.length) void recordSnapshots({ data: { rows } }).catch(() => undefined);
    };
    push();
    const i = setInterval(push, 5000);
    return () => clearInterval(i);
  }, []);

  // Signal recorder — every decision, fired or rejected, once per 5s slot.
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  useEffect(() => {
    const push = () => {
      const c = candleInfo(Date.now());
      const slot = Math.floor(c.elapsed / 5) * 5;
      const trace = getSignalTrace();
      const fired = new Map(signalsRef.current.map((s) => [s.pair, s]));
      const rows = trace
        .filter((t) => {
          const key = `${c.id}-${t.pair}-${t.verdict}-${slot}`;
          if (loggedSigRef.current.has(key)) return false;
          loggedSigRef.current.add(key);
          return true;
        })
        .map((t) => {
          const s = fired.get(t.pair);
          const m = marketsRef.current[t.pair];
          return {
            candle_id: c.id,
            seconds_in: slot,
            pair: t.pair as string,
            verdict: t.verdict,
            reason: t.reason,
            dir: s?.dir ?? t.dir ?? null,
            conf: s?.conf ?? null,
            calibrated: s?.calibrated ?? null,
            entry_price: s?.entry ?? null,
            ev: s?.ev ?? null,
            yes_mid: m?.yesMid ?? null,
            spread: m?.spread ?? null,
            skew: s?.skew ?? null,
            spot_mom: s?.spotMom ?? null,
            k_mom: s?.kMom ?? null,
            sigma_dist: s?.sigmaDist ?? null,
            spot: spotRef.current[t.pair]?.price ?? null,
            strike: m?.strike ?? null,
          };
        });
      if (rows.length) void recordSignals({ data: { rows } }).catch(() => undefined);
    };
    const i = setInterval(push, 5000);
    return () => clearInterval(i);
  }, []);



  const fire = useCallback(
    async (sig: Signal) => {
      const m = markets[sig.pair];
      if (!m?.ticker) return;
      firingRef.current = true;

      const priceCents = Math.max(
        1,
        Math.min(99, Math.round((sig.dir === "YES" ? m.yesAsk : m.noAsk) * 100)),
      );
      const count = Math.max(1, Math.floor(betSize / (priceCents / 100)));

      tradesRef.current += 1;
      tradedPairsRef.current.add(sig.pair);
      setTradedThisCandle(tradesRef.current >= maxTrades);
      setTradeStatus((s) => ({ ...s, [sig.id]: { status: "pending", msg: "Placing order…" } }));

      let status: TradeStatus = "placed";
      let msg = "";
      let filledCount = count;
      let filledPriceCents = priceCents;

      if (mode === "paper") {
        await new Promise((r) => setTimeout(r, 500));
        msg = `PAPER ${sig.dir} ×${count} @ ${priceCents}¢`;
      } else {
        const res = await placeOrder({
          data: {
            ticker: m.ticker,
            side: sig.dir === "YES" ? "yes" : "no",
            priceCents,
            count,
            maxPriceCents: Math.min(99, priceCents + MAX_SLIPPAGE_CENTS),
          },
        });
        if (res.ok) {
          filledCount = res.filled;
          filledPriceCents = res.priceCents;
          msg = `${sig.dir} ×${filledCount} @ ${priceCents}¢ · ${res.status}`;
        } else {
          status = "failed";
          msg = res.error ?? "Order rejected";
        }
      }

      setTradeStatus((s) => ({ ...s, [sig.id]: { status, msg } }));
      setLog((l) =>
        [
          {
            id: `${sig.id}-${Date.now()}`,
            time: new Date().toLocaleTimeString(),
            pair: sig.pair,
            dir: sig.dir,
            conf: sig.conf,
            status,
            msg,
            paper: mode === "paper",
          },
          ...l,
        ].slice(0, 30),
      );

      void recordTrade({
        data: {
          row: {
            candle_id: candleRef.current,
            pair: sig.pair,
            dir: sig.dir,
            mode,
            conf: sig.conf,
            calibrated: sig.calibrated,
            contracts: filledCount,
            entry_price: filledPriceCents / 100,
            stake: (filledCount * filledPriceCents) / 100,
            status,
            msg,
            order_id: null,
          },
        },
      }).catch(() => undefined);



      if (status === "placed") {
        const filledStake = (filledCount * filledPriceCents) / 100;
        setPlacedCount((c) => c + 1);
        setExposure((e) => e + filledStake);
        setOpen((l) => [
          {
            id: `${sig.id}-${Date.now()}`,
            pair: sig.pair,
            dir: sig.dir,
            count: filledCount,
            entry: filledPriceCents / 100,
            stake: filledStake,
            candleId: candleRef.current,
            paper: mode === "paper",
          },
          ...l,
        ]);
        setLastTrade({ label: `${sig.pair} ${sig.dir}`, time: new Date().toLocaleTimeString() });
        notify(
          `${sig.pair} ${sig.dir} — ${sig.conf.toFixed(0)}% · $${betSize} ${mode === "paper" ? "(paper)" : "PLACED"}`,
          sig.dir === "YES" ? "yes" : "no",
        );
        if (mode === "live") {
          void refreshLive();
          void refreshPortfolio();
        }
      } else {
        // Do NOT roll the counters back. Un-marking the pair here used to make
        // the next tick re-fire the same order 4-7x/second, each attempt
        // crossing harder until it filled far above the scored price.
        notify(`Trade failed: ${msg}`, "warn");
      }
      firingRef.current = false;
    },
    [betSize, markets, maxTrades, mode, notify, refreshLive, refreshPortfolio],
  );

  // Mark-to-market on the open book.
  const unrealized = useMemo(() => {
    return open.reduce((acc, p) => {
      const mid = markets[p.pair]?.yesMid ?? p.entry;
      const mark = p.dir === "YES" ? mid : 1 - mid;
      return acc + p.count * (mark - p.entry);
    }, 0);
  }, [markets, open]);

  const realized = mode === "live" ? portfolio.realized : realizedPaper;
  const walletBalance = portfolio.balance;

  // Today's real P&L: Kalshi realized since the first read of the day (plus the
  // live mark on anything still open) in live mode, paper results otherwise.
  const dayRealized =
    mode === "live" ? portfolio.realized - dayRef.current.base : realizedPaper;
  const dayPnl = dayRealized + unrealized;

  // Daily loss cap — hard stop for the rest of the day.
  useEffect(() => {
    if (dayPnl > -dailyLossCap) {
      if (capHit) setCapHit(false);
      return;
    }
    if (capHit) return;
    setCapHit(true);
    setBotOn(false);
    notify(
      `Daily loss cap hit (-$${dailyLossCap}) — auto-trading stopped for today.`,
      "no",
    );
  }, [capHit, dailyLossCap, dayPnl, notify]);

  // Arm LIVE MONEY at the $5 size as soon as the Kalshi key is verified. The
  // bot itself still needs BOT STATUS switched on before anything fires.
  useEffect(() => {
    if (armedRef.current || !live.configured || mode === "live") return;
    armedRef.current = true;
    setBetSize(5);
    setMode("live");
    notify("LIVE MONEY armed at $5 per trade — flip BOT STATUS on to trade.", "warn");
  }, [live.configured, mode, notify]);

  // Auto-trade: up to `maxTrades` per candle, one per pair, ranked by expected
  // value tilted by each pair's own settled edge — not simply the first signals.
  useEffect(() => {
    if (!botOn || firingRef.current || capHit) return;
    if (tradesRef.current >= maxTrades) return;
    const next = rankSignals(signals).find((s) => !tradedPairsRef.current.has(s.pair));
    if (!next) return;
    void fire(next);
  }, [botOn, capHit, fire, maxTrades, signals]);

  const toggleBot = useCallback(() => {
    setBotOn((on) => {
      const next = !on;
      notify(
        next
          ? "Auto-trading ON — fires after the 10:00 mark at 86%+"
          : "Auto-trading paused",
        next ? "yes" : "warn",
      );
      return next;
    });
  }, [notify]);

  const switchMode = useCallback(
    async (next: Mode) => {
      if (next === "live") {
        // Never let a flaky status check strand the user in paper mode: fall
        // back to the last known live state if the refresh itself fails.
        let st = live;
        try {
          st = await refreshLive();
        } catch (e) {
          notify(
            `Could not re-check Kalshi (${e instanceof Error ? e.message : "network error"}) — using last known status.`,
            "warn",
          );
        }
        if (!st.configured) {
          notify("Live mode needs your Kalshi API key on the server first.", "warn");
          return;
        }
        setBotOn(false);
        setMode("live");
        notify(
          st.error
            ? `LIVE mode armed, but Kalshi reported: ${st.error}`
            : "LIVE mode armed — real money orders. Bot switched off.",
          "warn",
        );
        return;
      }
      setMode("paper");
      notify("Paper mode — simulated fills on live market data.", "yes");
    },
    [live, notify, refreshLive],
  );


  return {
    spot,
    feedStatus,
    feedSource,
    markets,
    marketsOk,
    history: historyRef.current,
    signals,
    candle,
    mode,
    switchMode,
    botOn,
    toggleBot,
    betSize,
    setBetSize,
    maxTrades,
    setMaxTrades,
    placedCount,
    exposure,
    sigCount,
    log,
    lastTrade,
    toast,
    tradeStatus,
    tradedThisCandle,
    live,
    portfolio,
    walletBalance,
    dayPnl,
    dailyLossCap,
    setDailyLossCap,
    capHit,
    realized,
    unrealized,
    open,
    wins,
    losses,
    refreshPortfolio,
    accuracy,
    rejections,
    refreshAccuracy,

    evMargin,
    setEvMargin,
    pairs: PAIRS,
  };
}