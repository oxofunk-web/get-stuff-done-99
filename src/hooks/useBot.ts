import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBrtiFeed } from "./useBrtiFeed";
import { candleInfo } from "@/lib/bot/candle";
import { KALSHI_POLL_MS, PAIRS, type PairId } from "@/lib/bot/constants";
import { computeSignals } from "@/lib/bot/signals";
import type { KalshiMarket, Signal, TradeLogEntry, TradeStatus } from "@/lib/bot/types";
import { getLiveStatus, getMarkets, placeOrder } from "@/lib/kalshi.functions";

export type Mode = "paper" | "live";

export interface Toast {
  id: number;
  msg: string;
  tone: "yes" | "no" | "warn";
}

export function useBot() {
  const { spot, status: feedStatus, source: feedSource, tick } = useBrtiFeed();

  const [markets, setMarkets] = useState<Partial<Record<PairId, KalshiMarket>>>({});
  const [marketsOk, setMarketsOk] = useState<boolean | null>(null);
  const historyRef = useRef<Partial<Record<PairId, number[]>>>({});

  const [mode, setMode] = useState<Mode>("paper");
  const [botOn, setBotOn] = useState(false);
  const [betSize, setBetSize] = useState(3);
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

  const [now, setNow] = useState(() => Date.now());
  const candle = candleInfo(now);
  const candleRef = useRef(candle.id);
  const tradedRef = useRef(false);
  const firingRef = useRef(false);
  const seenSigIds = useRef<Set<string>>(new Set());
  const [tradedThisCandle, setTradedThisCandle] = useState(false);

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
      candleRef.current = candle.id;
      tradedRef.current = false;
      setTradedThisCandle(false);
      setTradeStatus({});
      seenSigIds.current = new Set();
    }
  }, [candle.id]);

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

  const fire = useCallback(
    async (sig: Signal) => {
      const m = markets[sig.pair];
      if (!m?.ticker) return;
      firingRef.current = true;
      tradedRef.current = true;
      setTradedThisCandle(true);
      setTradeStatus((s) => ({ ...s, [sig.id]: { status: "pending", msg: "Placing order…" } }));

      const priceCents = Math.max(
        1,
        Math.min(99, Math.round((sig.dir === "YES" ? m.yesAsk : m.noAsk) * 100)),
      );
      const count = Math.max(1, Math.floor(betSize / (priceCents / 100)));

      let status: TradeStatus = "placed";
      let msg = "";

      if (mode === "paper") {
        await new Promise((r) => setTimeout(r, 500));
        msg = `PAPER ${sig.dir} ×${count} @ ${priceCents}¢`;
      } else {
        const res = await placeOrder({
          data: { ticker: m.ticker, side: sig.dir === "YES" ? "yes" : "no", priceCents, count },
        });
        if (res.ok) {
          msg = `${sig.dir} ×${count} @ ${priceCents}¢ · ${res.status}`;
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

      if (status === "placed") {
        setPlacedCount((c) => c + 1);
        setExposure((e) => e + betSize);
        setLastTrade({ label: `${sig.pair} ${sig.dir}`, time: new Date().toLocaleTimeString() });
        notify(
          `${sig.pair} ${sig.dir} — ${sig.conf.toFixed(0)}% · $${betSize} ${mode === "paper" ? "(paper)" : "PLACED"}`,
          sig.dir === "YES" ? "yes" : "no",
        );
        if (mode === "live") void refreshLive();
      } else {
        notify(`Trade failed: ${msg}`, "warn");
      }
      firingRef.current = false;
    },
    [betSize, markets, mode, notify, refreshLive],
  );

  // Auto-trade: one trade per candle, top signal only
  useEffect(() => {
    if (!botOn || tradedRef.current || firingRef.current) return;
    const top = signals[0];
    if (!top) return;
    void fire(top);
  }, [botOn, fire, signals]);

  const toggleBot = useCallback(() => {
    setBotOn((on) => {
      const next = !on;
      notify(
        next
          ? "Auto-trading ON — fires after the 10:00 mark at 80%+"
          : "Auto-trading paused",
        next ? "yes" : "warn",
      );
      return next;
    });
  }, [notify]);

  const switchMode = useCallback(
    async (next: Mode) => {
      if (next === "live") {
        const st = await refreshLive();
        if (!st.configured) {
          notify("Live mode needs your Kalshi API key on the server first.", "warn");
          return;
        }
        if (st.error) {
          notify(`Kalshi auth error: ${st.error}`, "warn");
          return;
        }
        setBotOn(false);
        setMode("live");
        notify("LIVE mode armed — real money orders. Bot switched off.", "warn");
        return;
      }
      setMode("paper");
      notify("Paper mode — simulated fills on live market data.", "yes");
    },
    [notify, refreshLive],
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
    placedCount,
    exposure,
    sigCount,
    log,
    lastTrade,
    toast,
    tradeStatus,
    tradedThisCandle,
    live,
    pairs: PAIRS,
  };
}