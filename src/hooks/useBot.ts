import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBrtiFeed } from "./useBrtiFeed";
import { candleInfo } from "@/lib/bot/candle";
import {
  KALSHI_POLL_MS,
  DAILY_LOSS_CAP_DEFAULT,
  EV_MARGIN,
  GATE_PRESETS,
  MAX_SPREAD,
  MAX_TRADES_PER_CANDLE,
  MAX_YES_MID,
  MIN_SIGMA_DIST,
  MIN_SKEW,
  MIN_YES_MID,
  PAIRS,
  THRESHOLD,
  type GatePresetName,
  type PairId,
} from "@/lib/bot/constants";
import { computeSignals, getSignalTrace, setCalibration } from "@/lib/bot/signals";
import { pairVetoed, setPairEdge } from "@/lib/bot/ranking";

import { setTuning } from "@/lib/bot/tuning";
import {
  getAccuracy,
  getRejectionReport,
  getServerLooks,
  recordSignals,
  recordSnapshots,
  settleCandle,
  type AccuracyStats,
  type RejectionRow,
  type ServerLookRow,
} from "@/lib/bot/telemetry.functions";
import {
  getServerBot,
  updateServerBot,
  type ServerBotState,
} from "@/lib/bot/serverbot.functions";

import type { KalshiMarket, Signal, TradeLogEntry } from "@/lib/bot/types";
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
  const { spot, status: feedStatus, source: feedSource, tick, wakeCount } = useBrtiFeed();

  const [markets, setMarkets] = useState<Partial<Record<PairId, KalshiMarket>>>({});
  const [marketsOk, setMarketsOk] = useState<boolean | null>(null);
  /** Feed health for the markets panel: last good pull, real error, failed pairs. */
  interface MarketsHealth {
    lastOkAt: number | null;
    error: string | null;
    failures: { pair: string; error: string }[];
  }
  const [marketsHealth, setMarketsHealth] = useState<MarketsHealth>({
    lastOkAt: null,
    error: null,
    failures: [],
  });
  const marketsHealthRef = useRef<MarketsHealth>({ lastOkAt: null, error: null, failures: [] });


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

  // What the *server* runner thought about each pair on its last look. The
  // browser's own copy of the scoring code only sees this device's price
  // frames, so it must never be presented as the decision.
  const [serverLooks, setServerLooks] = useState<ServerLookRow[]>([]);
  const [serverFired, setServerFired] = useState<ServerLookRow[]>([]);
  useEffect(() => {
    const pull = async () => {
      try {
        const r = await getServerLooks();
        if (r.ok) {
          setServerLooks(r.rows);
          setServerFired(r.fired);
        }
      } catch {
        // keep last known looks
      }
    };
    void pull();
    const i = setInterval(() => void pull(), 5000);
    return () => clearInterval(i);
  }, []);


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

  // Keep the client-side signal display on the exact gates the server
  // enforces, so what the panel calls a signal is what the runner would fire.
  useEffect(() => {
    if (!server) return;
    setTuning({
      evMargin: server.evMargin,
      threshold: server.threshold,
      minYesMid: server.minYesMid,
      maxYesMid: server.maxYesMid,
      minSkew: server.minSkew,
      maxSpread: server.maxSpread,
      minSigmaDist: server.minSigmaDist,
      gateSecs: server.gateSecs,
    });
  }, [server]);

  const botOn = server?.enabled ?? false;
  const betSize = server?.betSize ?? 5;
  const maxTrades = server?.maxTrades ?? MAX_TRADES_PER_CANDLE;
  const dailyLossCap = server?.dailyLossCap ?? DAILY_LOSS_CAP_DEFAULT;
  const evMargin = server?.evMargin ?? EV_MARGIN;
  const gates = {
    threshold: server?.threshold ?? THRESHOLD,
    evMargin,
    minYesMid: server?.minYesMid ?? MIN_YES_MID,
    maxYesMid: server?.maxYesMid ?? MAX_YES_MID,
    minSkew: server?.minSkew ?? MIN_SKEW,
    maxSpread: server?.maxSpread ?? MAX_SPREAD,
    minSigmaDist: server?.minSigmaDist ?? MIN_SIGMA_DIST,
  };
  const gatePreset = server?.gatePreset ?? "balanced";

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
        ? "LIVE TRADING ON — real orders once the trade window opens, even with the app closed"
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
  const bootstrap = {
    enabled: server?.bootstrapEnabled ?? false,
    stake: server?.bootstrapStake ?? 2,
    maxDaily: server?.bootstrapMaxDaily ?? 10,
    maxEntry: server?.bootstrapMaxEntry ?? 0.55,
  };
  /** Tiny-stake learning mode — the only way to earn real outcomes cheaply. */
  const setBootstrap = useCallback(
    (patch: { bootstrapEnabled?: boolean; bootstrapStake?: number; bootstrapMaxDaily?: number; bootstrapMaxEntry?: number }) =>
      void applyServer(() => updateServerBot({ data: patch })),
    [applyServer],
  );

  const setEvMargin = useCallback(
    (n: number) => void applyServer(() => updateServerBot({ data: { evMargin: n } })),
    [applyServer],
  );
  /** Tune one gate by hand — the saved preset becomes CUSTOM server-side. */
  const setGate = useCallback(
    (patch: Partial<Record<keyof typeof GATE_PRESETS.balanced, number>>) =>
      void applyServer(() => updateServerBot({ data: patch })),
    [applyServer],
  );
  const setGatePreset = useCallback(
    (name: GatePresetName) =>
      void applyServer(() =>
        updateServerBot({ data: { ...GATE_PRESETS[name], gatePreset: name } }),
      ),
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

  // Kalshi orderbook polling (through the server, so no CORS and no key in the
  // browser). A failed pull retries quickly instead of waiting the full poll
  // interval, and the last good book stays on screen (up to STALE_DROP_MS) so a
  // hiccup never blanks the panel.
  const STALE_DROP_MS = 45000;
  const failsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullRef = useRef<() => void>(() => {});

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const spots: Record<string, number> = {};
        for (const p of PAIRS) {
          const px = spotRef.current[p.id]?.price;
          if (px) spots[p.id] = px;
        }
        const res = await getMarkets({ data: spots });
        if (stop) return;
        const next: Partial<Record<PairId, KalshiMarket>> = { ...marketsRef.current };
        const seen = new Set<PairId>();
        for (const m of res.markets) {
          const id = m.pair as PairId;
          seen.add(id);
          next[id] = m as KalshiMarket;
          const h = historyRef.current[id] ?? [];
          h.push(m.yesMid);
          if (h.length > 40) h.shift();
          historyRef.current[id] = h;
        }
        // Drop a carried-over book once it is too old to reason about.
        const lastOk = marketsHealthRef.current.lastOkAt;
        if (res.markets.length && lastOk && Date.now() - lastOk > STALE_DROP_MS) {
          for (const p of PAIRS) if (!seen.has(p.id)) delete next[p.id];
        }
        setMarkets(next);
        marketsRef.current = next;
        setMarketsOk(res.ok);
        failsRef.current = res.ok ? 0 : failsRef.current + 1;
        const health = {
          lastOkAt: res.ok ? Date.now() : marketsHealthRef.current.lastOkAt,
          error: res.ok ? null : (res.error ?? "Kalshi feed unavailable"),
          failures: res.failures ?? [],
        };
        marketsHealthRef.current = health;
        setMarketsHealth(health);
        if (!res.ok && failsRef.current < 3) schedule(2000);
      } catch (e) {
        if (stop) return;
        failsRef.current += 1;
        const health = {
          lastOkAt: marketsHealthRef.current.lastOkAt,
          error: e instanceof Error ? e.message : "Could not reach the market feed",
          failures: marketsHealthRef.current.failures,
        };
        marketsHealthRef.current = health;
        setMarketsHealth(health);
        if (failsRef.current >= 3) setMarketsOk(false);
        if (failsRef.current < 3) schedule(2000);
      }
    };
    const schedule = (ms: number) => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => void pull(), ms);
    };
    pullRef.current = () => {
      failsRef.current = 0;
      void pull();
    };
    void pull();
    const i = setInterval(() => void pull(), KALSHI_POLL_MS);
    return () => {
      stop = true;
      clearInterval(i);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  /** "Retry now" from the markets panel. */
  const retryMarkets = useCallback(() => pullRef.current(), []);


  // Live-credential probe
  const refreshLive = useCallback(async () => {
    try {
      const res = await getLiveStatus();
      if (!res || typeof res.configured !== "boolean") return null;
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
      if (!res || !Array.isArray(res.positions)) return null;
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

  // Coming back from the background: every interval was frozen, so pull all the
  // panels once instead of waiting out the next poll.
  useEffect(() => {
    if (!wakeCount) return;
    setNow(Date.now());
    seenSigIds.current = new Set();
    loggedSigRef.current = new Set();
    pullRef.current();
    void refreshServer();
    void refreshLive();
    void refreshPortfolio();
    void refreshAccuracy();
  }, [wakeCount, refreshServer, refreshLive, refreshPortfolio, refreshAccuracy]);



  // The phone's own scoring copy stays for the live tiles and the tape, but it
  // never decides what the user sees: it restarts empty on every refresh.
  const localSignals = useMemo(
    () => computeSignals(spot, markets, historyRef.current, now),
    // `tick` forces recompute as websocket ticks mutate the spot ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markets, now, tick],
  );
  void localSignals;

  // Signal cards come from the server runner's saved decisions for the current
  // candle, so a refresh (or a locked phone) never blanks the panel.
  const signals = useMemo<Signal[]>(() => {
    return serverFired
      .filter(
        (r) =>
          r.candleId === candle.id &&
          (r.dir === "YES" || r.dir === "NO") &&
          PAIRS.some((p) => p.id === r.pair),
      )

      .map((r) => ({
        id: `${r.candleId}-${r.pair}-${r.dir}-${r.secondsIn}`,
        pair: r.pair as PairId,
        dir: r.dir as "YES" | "NO",
        conf: r.conf ?? 0,
        yesMid: r.yesMid ?? 0,
        spread: r.spread ?? 0,
        spotMom: r.spotMom ?? 0,
        kMom: r.kMom ?? 0,
        lagDetected: false,
        calibrated: r.calibrated ?? 0,
        calibrationReady: false,
        calibrationSamples: 0,
        entry: r.entryPrice ?? r.yesMid ?? 0,
        ev: r.ev ?? 0,
        sigmaDist: r.sigmaDist ?? 0,
        skew: (r.yesMid ?? 0.5) - 0.5,
        reason: r.reason ?? "server signal",
        elapsed: r.secondsIn,
        remain: Math.max(0, candle.remain),
      }))
      .sort((a, b) => b.conf - a.conf);
  }, [serverLooks, candle.id, candle.remain]);

  // Why each pair is idle right now — so "no signals" reads as "here's what
  // every pair is waiting for" instead of a blank panel.
  const pairStatus = useMemo(() => {
    const trace = getSignalTrace();
    const looks = new Map(serverLooks.map((r) => [r.pair, r]));
    return PAIRS.map((p) => {
      const paused = pairVetoed(p.id);
      const srv = looks.get(p.id);
      const t = trace.find((x) => x.pair === p.id);
      // Local reasons are only a fallback, and a local data shortage says
      // nothing about the trader — never surface it as a blocker.
      const localReason =
        !t || t.reason === "not enough live data yet" ? null : t.reason;
      const ageSecs = srv ? Math.max(0, Math.round((now - Date.parse(srv.ts)) / 1000)) : null;
      const reason = paused
        ? "paused — losing record, cooling down"
        : srv
          ? `${srv.reason ?? srv.verdict}${ageSecs !== null && ageSecs > 90 ? ` · ${Math.round(ageSecs / 60)}m ago` : ""}`
          : (localReason ?? "waiting on the server's first look this candle");
      return {
        pair: p.id,
        verdict: srv?.verdict ?? t?.verdict ?? "rejected",
        reason,
        paused,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, now, serverLooks]);

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
          strike_type: m?.strikeType ?? null,
          quote_observed_at: m ? new Date().toISOString() : null,
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

  // No client-side signal logging: the server runner records every decision it
  // makes, and a second writer from an open tab only creates conflicting rows.



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
    marketsHealth,
    retryMarkets,

    history: historyRef.current,
    signals,
    candle,
    botOn,
    toggleBot,
    betSize,
    setBetSize,
    bootstrap,
    setBootstrap,
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
    gates,
    gatePreset,
    setGate,
    setGatePreset,
    pairs: PAIRS,
  };
}
