import { useEffect, useRef, useState } from "react";

import { useBrtiFeed } from "./useBrtiFeed";
import { candleInfo } from "@/lib/bot/candle";
import { PAIRS, type PairId } from "@/lib/bot/constants";
import { directionCall, type DirectionCall } from "@/lib/bot/direction";
import { getCoinCandles, type Candle } from "@/lib/candles.functions";

const CANDLE_MS = 900_000;

/**
 * Everything the reader needs: the coin's own 15-minute candles, live spot, and
 * one up/down call per coin for the candle that is forming right now.
 */
export function useDirection() {
  const { spot, status, source, tick } = useBrtiFeed();
  const [candles, setCandles] = useState<Partial<Record<PairId, Candle[]>>>({});
  const [chartOk, setChartOk] = useState<boolean | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const loading = useRef(false);

  const load = async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const res = await getCoinCandles();
      setCandles(res.candles);
      setChartOk(res.ok);
      setChartError(res.ok ? null : "Chart data unavailable right now");
    } catch (e) {
      setChartOk(false);
      setChartError(e instanceof Error ? e.message : "Chart data unavailable right now");
    } finally {
      loading.current = false;
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    const onWake = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onWake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  const now = Date.now();
  const candleStart = Math.floor(now / CANDLE_MS) * CANDLE_MS;

  /** Candle open from the exchange when we have it, otherwise the first live tick. */
  const openOf = (pair: PairId) => {
    const rows = candles[pair];
    const forming = rows?.find((k) => k.t === candleStart);
    if (forming?.o) return forming.o;
    return spot[pair]?.ticks[0]?.price;
  };

  const calls: DirectionCall[] = PAIRS.map((p) =>
    directionCall(p.id, spot[p.id], openOf(p.id), now),
  );

  /** Closed candles plus the one forming, so the chart shows the live bar. */
  const seriesFor = (pair: PairId): Candle[] => {
    const rows = (candles[pair] ?? []).filter((k) => k.t < candleStart);
    const s = spot[pair];
    if (!s?.price) return rows;
    const open = openOf(pair) ?? s.price;
    const prices = s.ticks.length ? s.ticks.map((t) => t.price) : [s.price];
    return [
      ...rows,
      {
        t: candleStart,
        o: open,
        h: Math.max(open, s.price, ...prices),
        l: Math.min(open, s.price, ...prices),
        c: s.price,
      },
    ];
  };

  return {
    spot,
    status,
    source,
    tick,
    candle: candleInfo(now),
    calls,
    seriesFor,
    chartOk,
    chartError,
    refreshCandles: load,
  };
}
