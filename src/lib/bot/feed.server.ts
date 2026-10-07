/**
 * Resilient price feed: Coinbase first (with timeout + retry), Kraken as backup.
 * Used by the auto-trader spot reads and by the direction-call grader.
 */
const CB: Record<string, string> = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD", DOGE: "DOGE-USD" };
const KR: Record<string, string> = { BTC: "XBTUSD", ETH: "ETHUSD", SOL: "SOLUSD", XRP: "XRPUSD", DOGE: "XDGUSD" };
const HEADERS = { "User-Agent": "coin-direction-reader" };

async function getJson<T>(url: string, tries = 2, timeoutMs = 4000): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return (await r.json()) as T;
      if (r.status !== 429 && r.status < 500) return null;
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 300 * (i + 1)));
  }
  return null;
}

export async function resilientSpot(pair: string): Promise<number | null> {
  const cb = await getJson<{ price?: string }>(`https://api.exchange.coinbase.com/products/${CB[pair]}/ticker`);
  const n = Number(cb?.price);
  if (Number.isFinite(n) && n > 0) return n;
  const kr = await getJson<{ result?: Record<string, { c?: string[] }> }>(
    `https://api.kraken.com/0/public/Ticker?pair=${KR[pair]}`,
  );
  const row = kr?.result ? Object.values(kr.result)[0] : undefined;
  const k = Number(row?.c?.[0]);
  return Number.isFinite(k) && k > 0 ? k : null;
}

/** Close of the 15-minute candle starting at `start` (ms). */
export async function candleClose(pair: string, start: number): Promise<number | null> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const end = start + 900_000;
  const c15 = await getJson<number[][]>(
    `https://api.exchange.coinbase.com/products/${CB[pair]}/candles?granularity=900&start=${iso(start)}&end=${iso(end)}`,
  );
  const r15 = Array.isArray(c15) ? c15.find((x) => (x[0] ?? 0) * 1000 === start) : undefined;
  if (r15?.[4]) return r15[4];
  // 1-minute fallback: close of the last minute inside the candle.
  const c1 = await getJson<number[][]>(
    `https://api.exchange.coinbase.com/products/${CB[pair]}/candles?granularity=60&start=${iso(end - 300_000)}&end=${iso(end)}`,
  );
  const r1 = Array.isArray(c1) ? c1.find((x) => (x[0] ?? 0) * 1000 === end - 60_000) : undefined;
  if (r1?.[4]) return r1[4];
  // Kraken backup: OHLC rows are [time, open, high, low, close, ...].
  const kr = await getJson<{ result?: Record<string, unknown> }>(
    `https://api.kraken.com/0/public/OHLC?pair=${KR[pair]}&interval=15&since=${start / 1000 - 1}`,
  );
  const rows = kr?.result ? (Object.entries(kr.result).find(([k]) => k !== "last")?.[1] as (string | number)[][] | undefined) : undefined;
  const kRow = rows?.find((x) => Number(x[0]) * 1000 === start);
  const kc = Number(kRow?.[4]);
  return Number.isFinite(kc) && kc > 0 ? kc : null;
}

/** Grade every finished, ungraded direction call. Safe to run every minute. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function gradeDirectionCalls(sb: any, max = 60) {
  const cutoff = Date.now() - 900_000 - 30_000;
  const { data: pending } = await sb
    .from("direction_calls")
    .select("id,pair,candle_start,dir,open_price")
    .is("result", null)
    .lt("candle_start", cutoff)
    .order("candle_start", { ascending: false })
    .limit(max);
  const closes = new Map<string, number | null>();
  let graded = 0;
  for (const p of (pending ?? []) as { id: string; pair: string; candle_start: number; dir: string; open_price: number }[]) {
    const key = `${p.pair}:${p.candle_start}`;
    if (!closes.has(key)) closes.set(key, await candleClose(p.pair, p.candle_start));
    const close = closes.get(key);
    if (close == null) continue;
    const up = close > p.open_price;
    const result = close === p.open_price ? "FLAT" : (p.dir === "UP") === up ? "WIN" : "LOSS";
    const { error } = await sb
      .from("direction_calls")
      .update({ close_price: close, result, graded_at: new Date().toISOString() })
      .eq("id", p.id);
    if (!error) graded++;
  }
  return { pending: pending?.length ?? 0, graded };
}
