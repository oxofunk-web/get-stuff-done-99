import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBrtiFeed } from "./useBrtiFeed";
import { candleInfo } from "@/lib/bot/candle";
import {
  KALSHI_POLL_MS,
  DAILY_LOSS_CAP_DEFAULT,
  MAX_TRADES_PER_CANDLE,
  PAIRS,
  type PairId,
} from "@/lib/bot/constants";
import { computeSignals, getSignalTrace, setCalibration } from "@/lib/bot/signals";
import { pairVetoed, setPairEdge } from "@/lib/bot/ranking";
import { setTuning } from "@/lib/bot/tuning";
import {
  getAccuracy,
  getRejectionReport,
  recordSignals,
  recordSnapshots,
  settleCandle,
  type AccuracyStats,
  type RejectionRow,
} from "@/lib/bot/telemetry.functions";
import {
  getServerBot,
  updateServerBot,
  type ServerBotState,
} from "@/lib/bot/serverbot.functions";

import type { KalshiMarket, TradeLogEntry } from "@/lib/bot/types";
import { getLiveStatus, getMarkets, getPortfolio } from "@/lib/kalshi.functions";


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
}

export interface Portfolio {
  configured: boolean;
  balance: number | null;
  realized: number;
  exposure: number;
  positions: { ticker: string; count: number; exposure: number; realized: number }[];
  error: string | null;
}

/**
 * The dashboard is a remote control + monitor for the ONE trader: the server
 * bot. It never places orders itself — every control here writes the shared
 * `bot_settings` row the server runner reads on each tick, so a sleeping
 * phone loses nothing and an open phone can never double a candle's trades.
 */
export function useBot() {
  const { spot, status: feedStatus, source: feedSource, tick } = useBrtiFeed();

  const [markets, setMarkets] = useState<Partial<Record<PairId, KalshiMarket>>>({});
  const [marketsOk, setMarketsOk] = useState<boolean | null>(null);
  const historyRef = useRef<Partial<Record<PairId, number[]>>>({});
  const marketsRef = useRef<Partial<Record<PairId, KalshiMarket>>>({});

  // ---- server bot (the only trader) ----------------------------------------
  const [server, setServer] = useState<ServerBotState | null>(null);

  const refreshServer = useCallback(async () => {
    try {
      setServer(await getServerBot());
    } catch {
      // keep last known state on a transient failure
    }
  }, []);

  useEffect(() => {
    void refreshServer();
    const i = setInterval(() => void refreshServer(), 15000);
    return () => clearInterval(i);
  }, [refreshServer]);

  const [sigCount, setSigCount] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
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

  const [now, setNow] = useState(() => Date.now());
  const candle = candleInfo(now);
  const candleRef = useRef(candle.id);
  const seenSigIds = useRef<Set<string>>(new Set());

  // ---- telemetry / accuracy -------------------------------------------------
  const [accuracy, setAccuracy] = useState<AccuracyStats | null>(null);
  const [rejections, setRejections] = useState<RejectionRow[]>([]);
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const loggedSigRef = useRef<Set<string>>(new Set());

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

  // ---- controls: write straight to the shared server settings ---------------
  const applyServer = useCallback(
    async (fn: () => Promise<ServerBotState>) => {
      try {
        const res = await fn();
        setServer(res);
        return res;
      } catch (e) {
        notify(e instanceof Error ? e.message : "Update failed", "warn");
        return null;
      }
    },
    [notify],
  );

  // Keep the client-side signal display on the same EV gate the server
  // enforces, so what the panel calls a signal is what the runner would fire.
  useEffect(() => {
    if (server) setTuning({ evMargin: server.evMargin });
  }, [server]);

  const botOn = server?.enabled ?? false;
  const betSize = server?.betSize ?? 5;
  const maxTrades = server?.maxTrades ?? MAX_TRADES_PER_CANDLE;
  const dailyLossCap = server?.dailyLossCap ?? DAILY_LOSS_CAP_DEFAULT;
  const evMargin = server?.evMargin ?? 0.08;
  const takeProfitCents = server?.takeProfitCents ?? 12;
  const stopLossCents = server?.stopLossCents ?? 10;

  // One switch, live money. Turning it on arms real orders immediately.
  const toggleBot = useCallback(() => {
    const next = !botOn;
    if (next && !live.configured) {
      notify("Live trading needs your Kalshi API key on the server first.", "warn");
      return;
    }
    void applyServer(() => updateServerBot({ data: { enabled: next } }));
    notify(
      next
        ? "LIVE TRADING ON — real orders after the 10:00 mark at 86%+, even with the app closed"
        : "Live trading OFF — no new orders will be placed",
      next ? "no" : "warn",
    );
  }, [applyServer, botOn, live.configured, notify]);

  const setBetSize = useCallback(
    (n: number) => void applyServer(() => updateServerBot({ data: { betSize: n } })),
    [applyServer],
  );
  const setMaxTrades = useCallback(
    (n: number) => void applyServer(() => updateServerBot({ data: { maxTrades: n } })),
    [applyServer],
  );
  const setDailyLossCap = useCallback(
    (n: number) => void applyServer(() => updateServerBot({ data: { dailyLossCap: n } })),
    [applyServer],
  );
  const setEvMargin = useCallback(
    (n: number) => void applyServer(() => updateServerBot({ data: { evMargin: n } })),
    [applyServer],
  );
  const setTakeProfitCents = useCallback(
    (n: number) => void applyServer(() => updateServerBot({ data: { takeProfitCents: n } })),
    [applyServer],
  );
  const setStopLossCents = useCallback(
    (n: number) => void applyServer(() => updateServerBot({ data: { stopLossCents: n } })),
    [applyServer],
  );

  // Clock
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, []);

  // Candle rollover: grade the candle that just closed so calibration keeps
  // learning. Trade settlement itself runs on the server cron.
  useEffect(() => {
    if (candle.id !== candleRef.current) {
      const closed = candleRef.current;
      candleRef.current = candle.id;
      seenSigIds.current = new Set();
      loggedSigRef.current = new Set();

      const finals = PAIRS.map((p) => ({ pair: p.id, spot: spotRef.current[p.id]?.price ?? 0 })).filter(
        (f) => f.spot > 0,
      );
      if (finals.length) {
        void settleCandle({ data: { candleId: closed, finals } })
          .then(() => refreshAccuracy())
          .catch(() => undefined);
      }
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
  const dayRef = useRef<{ day: string; base: number }>({ day: "", base: 0 });
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

  // Why each pair is idle right now — so "no signals" reads as "here's what
  // every pair is waiting for" instead of a blank panel.
  const pairStatus = useMemo(() => {
    const trace = getSignalTrace();
    return PAIRS.map((p) => {
      const t = trace.find((x) => x.pair === p.id);
      const paused = pairVetoed(p.id);
      return {
        pair: p.id,
        verdict: t?.verdict ?? "rejected",
        reason: paused ? "paused — losing record, cooling down" : (t?.reason ?? "waiting for data"),
        paused,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, now]);

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

  // ---- read models derived from the server bot + Kalshi account -------------

  // Open positions come from the real account (live). Ticker prefix maps back
  // to a pair; entry = exposure / contracts.
  const open: OpenPosition[] = useMemo(() => {
    return portfolio.positions
      .map((p, i) => {
        const pair = PAIRS.find((x) => p.ticker.startsWith(x.series));
        if (!pair || p.count === 0) return null;
        const count = Math.abs(p.count);
        return {
          id: `${p.ticker}-${i}`,
          pair: pair.id,
          dir: (p.count > 0 ? "YES" : "NO") as "YES" | "NO",
          count,
          entry: count > 0 ? p.exposure / count : 0,
          stake: p.exposure,
          candleId: candle.id,
        };
      })
      .filter((p): p is OpenPosition => p !== null);
  }, [portfolio.positions, candle.id]);

  // Mark-to-market on the open book.
  const unrealized = useMemo(() => {
    return open.reduce((acc, p) => {
      const mid = markets[p.pair]?.yesMid ?? p.entry;
      const mark = p.dir === "YES" ? mid : 1 - mid;
      return acc + p.count * (mark - p.entry);
    }, 0);
  }, [markets, open]);

  const realized = portfolio.realized;
  const walletBalance = portfolio.balance;
  const exposure = portfolio.exposure;

  // Today's real P&L: Kalshi realized since the first read of the day (plus
  // the live mark on anything still open).
  const dayRealized = portfolio.realized - dayRef.current.base;
  const dayPnl = dayRealized + unrealized;

  // Server trade log → dashboard stats and the trade log panel.
  const serverTrades = server?.recentTrades ?? [];
  const log: TradeLogEntry[] = useMemo(
    () =>
      serverTrades.map((t) => ({
        id: t.ts + t.pair,
        time: new Date(t.ts).toLocaleTimeString(),
        pair: t.pair as PairId,
        dir: t.dir as "YES" | "NO",
        conf: 0,
        status: t.status === "placed" ? "placed" : "failed",
        msg: t.msg ?? "",
        exitReason: t.exit_reason,
        pnl: t.pnl,
      })),
    [serverTrades],
  );
  const placedCount = useMemo(
    () => serverTrades.filter((t) => t.status === "placed").length,
    [serverTrades],
  );
  const lastTrade = useMemo(() => {
    const t = serverTrades.find((x) => x.status === "placed");
    return t ? { label: `${t.pair} ${t.dir}`, time: new Date(t.ts).toLocaleTimeString() } : null;
  }, [serverTrades]);
  const tradedThisCandle = useMemo(
    () =>
      serverTrades.filter((t) => t.status === "placed" && t.candle_id === candle.id).length >=
      maxTrades,
    [serverTrades, candle.id, maxTrades],
  );

  // Settled win/loss record across everything the bot has placed.
  const wins = accuracy?.ok ? accuracy.wins : 0;
  const losses = accuracy?.ok ? Math.max(0, accuracy.total - accuracy.wins) : 0;

  // Daily loss cap banner — the server enforces the stop itself; this just
  // mirrors it on the dashboard.
  const capHit = dayPnl <= -dailyLossCap;

  // Manual "start a fresh day": re-anchor today's P&L to the wallet as it
  // stands now so the banner clears, without touching the cap value.
  const resetDay = useCallback(() => {
    dayRef.current = { day: new Date().toDateString(), base: portfolio.realized };
    notify("Day reset — the banner clears here; the server cap follows today's settled trades.", "warn");
  }, [notify, portfolio.realized]);

  return {
    spot,
    feedStatus,
    feedSource,
    markets,
    marketsOk,
    history: historyRef.current,
    signals,
    candle,
    takeProfitCents,
    setTakeProfitCents,
    stopLossCents,
    setStopLossCents,
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
    tradedThisCandle,
    live,
    portfolio,
    walletBalance,
    dayPnl,
    dailyLossCap,
    setDailyLossCap,
    capHit,
    resetDay,
    pairStatus,
    realized,
    unrealized,
    open,
    wins,
    losses,
    refreshPortfolio,
    accuracy,
    rejections,
    refreshAccuracy,
    server,

    evMargin,
    setEvMargin,
    pairs: PAIRS,
  };
}
