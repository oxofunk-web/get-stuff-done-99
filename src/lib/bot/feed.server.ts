/**
 * Resilient price feed with a provider chain: Coinbase → Kraken → Binance.US.
 * Each attempt is capped at ~5s. Every read reports which provider served it,
 * so the auto-trader can show "feed: kraken" when it falls back.
 * Plumbing only — no strategy logic lives here.
 */
export type Provider = "coinbase" | "kraken" | "binanceus";
const CB: Record<string, string> = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD", DOGE: "DOGE-USD" };
const KR: Record<string, string> = { BTC: "XBTUSD", ETH: "ETHUSD", SOL: "SOLUSD", XRP: "XRPUSD", DOGE: "XDGUSD" };
const BU: Record<string, string> = { BTC: "BTCUSD", ETH: "ETHUSD", SOL: "SOLUSD", XRP: "XRPUSD", DOGE: "DOGEUSD" };
const HEADERS = { "User-Agent": "coin-direction-reader" };
const ATTEMPT_MS = 5000;

async function getJson<T>(url: string, tries = 1, timeoutMs = ATTEMPT_MS): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return (await r.json()) as T;
      if (r.status !== 429 && r.status < 500) return null;
    } catch {
      /* retry / fall through */
    }
    if (i + 1 < tries) await new Promise((res) => setTimeout(res, 300 * (i + 1)));
  }
  return null;
}

const pos = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** Run providers in order; first non-null value wins. */
async function chain<T>(steps: [Provider, () => Promise<T | null>][]): Promise<{ value: T; provider: Provider } | null> {
  for (const [provider, fn] of steps) {
    try {
      const value = await fn();
      if (value != null) return { value, provider };
    } catch {
      /* next provider */
    }
  }
  return null;
}

function krakenRows(j: { result?: Record<string, unknown> } | null) {
  return j?.result ? (Object.entries(j.result).find(([k]) => k !== "last")?.[1] as (string | number)[][] | undefined) : undefined;
}

/** Spot price with provider. */
export async function spotWithProvider(pair: string) {
  return chain<number>([
    ["coinbase", async () => pos((await getJson<{ price?: string }>(`https://api.exchange.coinbase.com/products/${CB[pair]}/ticker`))?.price)],
    ["kraken", async () => {
      const kr = await getJson<{ result?: Record<string, { c?: string[] }> }>(`https://api.kraken.com/0/public/Ticker?pair=${KR[pair]}`);
      const row = kr?.result ? Object.values(kr.result)[0] : undefined;
      return pos(row?.c?.[0]);
    }],
    ["binanceus", async () => pos((await getJson<{ price?: string }>(`https://api.binance.us/api/v3/ticker/price?symbol=${BU[pair]}`))?.price)],
  ]);
}

export async function resilientSpot(pair: string): Promise<number | null> {
  return (await spotWithProvider(pair))?.value ?? null;
}

/** OHLC of the 15-min candle starting at `start` (ms): [open, close]. Close may be the forming value. */
async function candle15(pair: string, start: number) {
  const iso = (ms: number) => new Date(ms).toISOString();
  return chain<{ o: number; c: number }>([
    ["coinbase", async () => {
      const rows = await getJson<number[][]>(
        `https://api.exchange.coinbase.com/products/${CB[pair]}/candles?granularity=900&start=${iso(start)}&end=${iso(start + 900_000)}`,
      );
      const r = Array.isArray(rows) ? rows.find((x) => (x[0] ?? 0) * 1000 === start) : undefined;
      const o = pos(r?.[3]), c = pos(r?.[4]);
      return o && c ? { o, c } : null;
    }],
    ["kraken", async () => {
      const j = await getJson<{ result?: Record<string, unknown> }>(
        `https://api.kraken.com/0/public/OHLC?pair=${KR[pair]}&interval=15&since=${start / 1000 - 1}`,
      );
      const r = krakenRows(j)?.find((x) => Number(x[0]) * 1000 === start);
      const o = pos(r?.[1]), c = pos(r?.[4]);
      return o && c ? { o, c } : null;
    }],
    ["binanceus", async () => {
      const rows = await getJson<(string | number)[][]>(
        `https://api.binance.us/api/v3/klines?symbol=${BU[pair]}&interval=15m&startTime=${start}&limit=1`,
      );
      const r = Array.isArray(rows) ? rows.find((x) => Number(x[0]) === start) : undefined;
      const o = pos(r?.[1]), c = pos(r?.[4]);
      return o && c ? { o, c } : null;
    }],
  ]);
}

/** Open of the 15-minute candle starting at `start` (ms), with provider. */
export async function candleOpenWithProvider(pair: string, start: number) {
  const r = await candle15(pair, start);
  return r ? { value: r.value.o, provider: r.provider } : null;
}

/** Recent trades (oldest first), with provider. */
export async function recentTradesWithProvider(pair: string) {
  return chain<{ ts: number; price: number }[]>([
    ["coinbase", async () => {
      const rows = await getJson<{ time: string; price: string }[]>(`https://api.exchange.coinbase.com/products/${CB[pair]}/trades?limit=100`);
      return Array.isArray(rows) && rows.length ? rows.map((t) => ({ ts: new Date(t.time).getTime(), price: Number(t.price) })) : null;
    }],
    ["kraken", async () => {
      const rows = krakenRows(await getJson<{ result?: Record<string, unknown> }>(`https://api.kraken.com/0/public/Trades?pair=${KR[pair]}&count=100`));
      return rows?.length ? rows.map((t) => ({ ts: Number(t[2]) * 1000, price: Number(t[0]) })) : null;
    }],
    ["binanceus", async () => {
      const rows = await getJson<{ time: number; price: string }[]>(`https://api.binance.us/api/v3/trades?symbol=${BU[pair]}&limit=100`);
      return Array.isArray(rows) && rows.length ? rows.map((t) => ({ ts: t.time, price: Number(t.price) })) : null;
    }],
  ]).then((r) =>
    r ? { provider: r.provider, value: r.value.filter((t) => Number.isFinite(t.price) && t.price > 0).sort((a, b) => a.ts - b.ts) } : null,
  );
}

/** Close of the 15-minute candle starting at `start` (ms). Only meaningful once the candle has finished. */
export async function candleClose(pair: string, start: number): Promise<number | null> {
  return (await candle15(pair, start))?.value.c ?? null;
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
