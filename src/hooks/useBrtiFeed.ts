import { useEffect, useRef, useState } from "react";

import { WS_MAP, WS_URL, type PairId } from "@/lib/bot/constants";
import type { SpotState } from "@/lib/bot/types";

export type FeedStatus = "connecting" | "live" | "down";

/**
 * Real-time BRTI proxy: Binance ticker stream (a BRTI constituent exchange).
 * Browser-only — the socket is opened after hydration.
 */
export function useBrtiFeed() {
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [tick, setTick] = useState(0);
  const spotRef = useRef<Partial<Record<PairId, SpotState>>>({});

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      setStatus("connecting");
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setStatus("live");
      ws.onerror = () => setStatus("down");
      ws.onclose = () => {
        if (closed) return;
        setStatus("down");
        retry = setTimeout(connect, 3000);
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as { data?: { s?: string; c?: string; P?: string } };
          const d = msg.data;
          if (!d?.s) return;
          const sym = WS_MAP[d.s.toLowerCase()];
          if (!sym) return;
          const price = parseFloat(d.c ?? "0");
          if (!price) return;
          const ch24 = parseFloat(d.P ?? "0");
          const cur = spotRef.current[sym];
          if (!cur) {
            spotRef.current[sym] = {
              price,
              prev: price,
              change24h: ch24,
              ts: Date.now(),
              ticks: [{ price, ts: Date.now() }],
            };
          } else {
            cur.prev = cur.price;
            cur.price = price;
            cur.change24h = ch24;
            cur.ts = Date.now();
            cur.ticks.push({ price, ts: Date.now() });
            if (cur.ticks.length > 120) cur.ticks.shift();
          }
        } catch {
          // ignore malformed frames
        }
      };
    };

    connect();
    const paint = setInterval(() => setTick((t) => t + 1), 700);

    return () => {
      closed = true;
      clearInterval(paint);
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { spot: spotRef.current, status, tick };
}