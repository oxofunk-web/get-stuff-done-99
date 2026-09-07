import { useEffect, useRef, useState } from "react";

import {
  CB_MAP,
  CB_PRODUCTS,
  CB_WS_URL,
  FEED_TIMEOUT_MS,
  REST_POLL_MS,
  WS_MAP,
  WS_URL,
  type PairId,
} from "@/lib/bot/constants";
import type { SpotState } from "@/lib/bot/types";
import { getSpotPrices } from "@/lib/prices.functions";

export type FeedStatus = "connecting" | "live" | "down";
export type FeedSource = "coinbase" | "binance" | "server";

/**
 * Real-time BRTI proxy with automatic failover:
 *   1. Coinbase Exchange socket (BRTI constituent, works on US networks)
 *   2. Binance socket
 *   3. Server-side REST polling — always reachable, even when the device's
 *      network blocks exchange endpoints entirely (mobile carriers, geo-blocks)
 */
export function useBrtiFeed() {
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [source, setSource] = useState<FeedSource>("coinbase");
  const [tick, setTick] = useState(0);
  /** Bumped every time the app comes back from the background. */
  const [wakeCount, setWakeCount] = useState(0);
  const spotRef = useRef<Partial<Record<PairId, SpotState>>>({});
  const lastFrameRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let gotFrame = false;


    const push = (sym: PairId | undefined, price: number, change24h: number) => {
      if (!sym || !price || !Number.isFinite(price)) return;
      gotFrame = true;
      setStatus("live");
      const now = Date.now();
      const cur = spotRef.current[sym];
      if (!cur) {
        spotRef.current[sym] = {
          price,
          prev: price,
          change24h,
          ts: now,
          ticks: [{ price, ts: now }],
        };
        return;
      }
      cur.prev = cur.price;
      cur.price = price;
      cur.change24h = change24h;
      cur.ts = now;
      cur.ticks.push({ price, ts: now });
      if (cur.ticks.length > 120) cur.ticks.shift();
    };

    const cleanupSocket = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
      if (ws) {
        ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
        try {
          ws.close();
        } catch {
          /* already closed */
        }
        ws = null;
      }
    };

    /** Final fallback: our own server fetches the prices and we poll it. */
    const startServerPolling = () => {
      cleanupSocket();
      if (disposed) return;
      setSource("server");
      const run = async () => {
        try {
          const res = await getSpotPrices();
          if (disposed) return;
          if (!res.ok) {
            setStatus("down");
            return;
          }
          for (const [sym, v] of Object.entries(res.prices)) {
            if (v) push(sym as PairId, v.price, v.change24h);
          }
        } catch {
          if (!disposed) setStatus("down");
        }
      };
      void run();
      poll = setInterval(() => void run(), REST_POLL_MS);
    };

    const startBinance = () => {
      cleanupSocket();
      if (disposed) return;
      setSource("binance");
      setStatus("connecting");
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        startServerPolling();
        return;
      }
      const sock = ws;
      watchdog = setTimeout(() => {
        if (!gotFrame) startServerPolling();
      }, FEED_TIMEOUT_MS);
      sock.onerror = () => {
        if (!gotFrame) startServerPolling();
      };
      sock.onclose = () => {
        if (disposed) return;
        if (!gotFrame) startServerPolling();
        else {
          setStatus("down");
          watchdog = setTimeout(startBinance, 3000);
        }
      };
      sock.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as {
            data?: { s?: string; c?: string; P?: string };
          };
          const d = msg.data;
          if (!d?.s) return;
          push(WS_MAP[d.s.toLowerCase()], parseFloat(d.c ?? "0"), parseFloat(d.P ?? "0"));
        } catch {
          /* malformed frame */
        }
      };
    };

    const startCoinbase = () => {
      cleanupSocket();
      if (disposed) return;
      setSource("coinbase");
      setStatus("connecting");
      try {
        ws = new WebSocket(CB_WS_URL);
      } catch {
        startBinance();
        return;
      }
      const sock = ws;
      watchdog = setTimeout(() => {
        if (!gotFrame) startBinance();
      }, FEED_TIMEOUT_MS);
      sock.onopen = () => {
        sock.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: [...CB_PRODUCTS],
            channels: ["ticker"],
          }),
        );
      };
      sock.onerror = () => {
        if (!gotFrame) startBinance();
      };
      sock.onclose = () => {
        if (disposed) return;
        if (!gotFrame) startBinance();
        else {
          setStatus("down");
          watchdog = setTimeout(startCoinbase, 3000);
        }
      };
      sock.onmessage = (evt) => {
        try {
          const d = JSON.parse(evt.data as string) as {
            type?: string;
            product_id?: string;
            price?: string;
            open_24h?: string;
          };
          if (d.type !== "ticker" || !d.product_id) return;
          const price = parseFloat(d.price ?? "0");
          const open = parseFloat(d.open_24h ?? "0");
          push(CB_MAP[d.product_id], price, open > 0 ? ((price - open) / open) * 100 : 0);
        } catch {
          /* malformed frame */
        }
      };
    };

    startCoinbase();
    // A steady one-second heartbeat keeps freshness visible even between ticks.
    const paint = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      disposed = true;
      clearInterval(paint);
      if (poll) clearInterval(poll);
      cleanupSocket();
    };
  }, []);

  return { spot: spotRef.current, status, source, tick };
}