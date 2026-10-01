/**
 * Candle-start scalper (BTC + ETH only).
 * 0:30–2:00 into each 15-minute candle: AI reads the opening move and picks UP,
 * DOWN or SKIP. If the contract on that side costs 45–55¢ it buys, then watches
 * the bid every 2s and sells at +15¢ (profit), -10¢ (stop) or at 6:00 (time out).
 * Separate from the last-5-minute locked-call trader; touches none of its rules.
 */
import { authedKalshi, fetchMarket, fetchOpenMarketWithReason, normalizeMarket, placeLiveOrder } from "../kalshi.server";
import { mapOrderToBook } from "./order-map";

const CANDLE_MS = 900_000;
const PAIRS = ["BTC", "ETH"] as const;
type ScalpPair = (typeof PAIRS)[number];
const PRODUCT: Record<ScalpPair, string> = { BTC: "BTC-USD", ETH: "ETH-USD" };
const ENTRY_FROM = 30;
const ENTRY_UNTIL = 120;
const MIN_ENTRY = 45;
const MAX_ENTRY = 55;
const TAKE_PROFIT = 15;
const STOP_LOSS = 10;
const MAX_HOLD_UNTIL = 360; // seconds into candle
const POLL_MS = 2000;
const RUN_MS = 50_000;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function coinbase<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`https://api.exchange.coinbase.com${path}`, { headers: { "User-Agent": "scalper" } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** What the AI sees: open, last price, recent 1-minute closes, opening trades drift. */
async function snapshot(pair: ScalpPair, candleStart: number) {
  const iso = (ms: number) => new Date(ms).toISOString();
  const [c15, c1, trades] = await Promise.all([
    coinbase<number[][]>(`/products/${PRODUCT[pair]}/candles?granularity=900&start=${iso(candleStart - 4 * CANDLE_MS)}&end=${iso(candleStart + CANDLE_MS)}`),
    coinbase<number[][]>(`/products/${PRODUCT[pair]}/candles?granularity=60&start=${iso(candleStart - 20 * 60_000)}&end=${iso(Date.now())}`),
    coinbase<{ time: string; price: string; size: string; side: string }[]>(`/products/${PRODUCT[pair]}/trades?limit=200`),
  ]);
  const fresh = (trades ?? []).filter((t) => new Date(t.time).getTime() >= candleStart);
  // Coinbase indexes a new 15m candle 30-60s late: fall back to the first 1m candle,
  // then the oldest trade inside this candle.
  const firstMin = (c1 ?? []).find((x) => (x[0] ?? 0) * 1000 === candleStart);
  const oldestFresh = fresh.length ? Number(fresh[fresh.length - 1]!.price) : null;
  const open = c15?.find((x) => (x[0] ?? 0) * 1000 === candleStart)?.[3] ?? firstMin?.[3] ?? oldestFresh ?? null;
  let last = Number(trades?.[0]?.price ?? 0) || null;
  if (!last) {
    const t = await coinbase<{ price?: string }>(`/products/${PRODUCT[pair]}/ticker`);
    last = Number(t?.price ?? 0) || null;
  }
  // Coinbase "side" is the maker side: "sell" maker = aggressive buyer.
  let buyVol = 0;
  let sellVol = 0;
  for (const t of fresh) (t.side === "sell" ? (buyVol += Number(t.size)) : (sellVol += Number(t.size)));
  return {
    open,
    last,
    prev15: (c15 ?? []).filter((x) => (x[0] ?? 0) * 1000 < candleStart).map((x) => ({ open: x[3], close: x[4] })),
    oneMinCloses: (c1 ?? []).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)).map((x) => x[4]),
    openingBuyVol: +buyVol.toFixed(4),
    openingSellVol: +sellVol.toFixed(4),
  };
}

type AiCall = { direction: "UP" | "DOWN" | "SKIP"; confidence: number; reason: string };

/** Streaming Responses call; returns null on any failure so trading never hangs on AI. */
async function askAi(pair: ScalpPair, data: unknown): Promise<AiCall | { error: string }> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) return { error: "AI not configured" };
  let res: Response;
  try {
    res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        instructions:
          "You are a crypto scalper. Decide if the coin's price will be ABOVE (UP) or BELOW (DOWN) the 15-minute candle open over the next 2-5 minutes. Use the opening drift, buy/sell volume imbalance and recent trend. Answer SKIP when the move is flat, choppy or the signals disagree. Be selective: only call UP/DOWN with confidence >= 65 when evidence is clear.",
        input: `${pair} data: ${JSON.stringify(data)}`,
        text: {
          format: {
            type: "json_schema",
            name: "scalp_call",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                direction: { type: "string", enum: ["UP", "DOWN", "SKIP"] },
                confidence: { type: "number" },
                reason: { type: "string" },
              },
              required: ["direction", "confidence", "reason"],
            },
          },
        },
      }),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI unreachable" };
  }
  if (!res.ok || !res.body) {
    let msg = `AI error ${res.status}`;
    try {
      const b = (await res.json()) as { error?: { message?: string }; message?: string };
      msg = b.error?.message ?? b.message ?? msg;
    } catch {
      /* keep */
    }
    return { error: msg };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload) as { type?: string; delta?: string };
        if (ev.type === "response.output_text.delta" && ev.delta) text += ev.delta;
      } catch {
        /* partial */
      }
    }
  }
  try {
    return JSON.parse(text) as AiCall;
  } catch {
    return { error: "AI answer unreadable" };
  }
}

async function enter(pair: ScalpPair, candleStart: number, size: number, creds: { keyId: string; pem: string }) {
  const sb = await db();
  const log = (row: Record<string, unknown>) =>
    sb.from("trade_log").insert({ candle_id: candleStart, pair, mode: "live", source: "scalp", strategy_version: "scalp-v1", ...row } as never);

  const snap = await snapshot(pair, candleStart);
  if (!snap.open || !snap.last) {
    // Retry next loop while still inside the entry window; only log once it's over.
    if ((Date.now() - candleStart) / 1000 < ENTRY_UNTIL - 5) return null;
    await log({ dir: "SKIP", status: "skipped", msg: "No price data yet" });
    return `${pair}: no data`;
  }
  const ai = await askAi(pair, snap);
  if ("error" in ai) {
    await log({ dir: "SKIP", status: "skipped", msg: `AI: ${ai.error}` });
    return `${pair}: AI ${ai.error}`;
  }
  if (ai.direction === "SKIP" || ai.confidence < 65) {
    await log({ dir: "SKIP", status: "skipped", conf: ai.confidence, msg: `AI skip: ${ai.reason}` });
    return `${pair}: AI skip`;
  }
  const { market: raw, error } = await fetchOpenMarketWithReason(`KX${pair}15M`, snap.last);
  if (!raw) {
    await log({ dir: ai.direction, status: "skipped", conf: ai.confidence, msg: `No contract: ${error}` });
    return `${pair}: ${error}`;
  }
  const m = normalizeMarket(raw);
  if (m.strike == null || !m.strikeType) {
    await log({ dir: ai.direction, status: "skipped", msg: "Contract has no line", ticker: m.ticker });
    return `${pair}: no line`;
  }
  // floor: YES = finishes above. cap: YES = finishes below.
  const side: "yes" | "no" = (m.strikeType === "floor") === (ai.direction === "UP") ? "yes" : "no";
  const ask = Math.round((side === "yes" ? m.yesAsk : m.noAsk) * 100);
  const base = { dir: ai.direction, conf: ai.confidence, ticker: m.ticker, strike: m.strike, strike_type: m.strikeType };
  if (ask < MIN_ENTRY || ask > MAX_ENTRY) {
    await log({ ...base, status: "skipped", msg: `Contract at ${ask}¢ — outside the ${MIN_ENTRY}–${MAX_ENTRY}¢ scalp zone` });
    return `${pair}: price ${ask}¢ out of zone`;
  }
  const count = Math.max(1, Math.floor(size / (ask / 100)));
  const res = await placeLiveOrder(creds, {
    ticker: m.ticker,
    side,
    priceCents: Math.min(MAX_ENTRY, ask + 1),
    maxPriceCents: MAX_ENTRY,
    count,
    quote: m,
  });
  if (!res.ok) {
    await log({ ...base, status: "skipped", msg: res.error, requested_contracts: count });
    return `${pair}: ${res.error}`;
  }
  const entry = res.priceCents / 100;
  await log({
    ...base,
    status: "placed",
    msg: `AI ${ai.direction} ${Math.round(ai.confidence)}% · ${ai.reason} · ${side.toUpperCase()} ${res.filled} @ ${res.priceCents}¢`,
    order_id: res.orderId,
    contracts: res.filled,
    requested_contracts: count,
    entry_price: entry,
    stake: res.filled * entry,
  });
  return `${pair}: BOUGHT ${res.filled} @ ${res.priceCents}¢ (${ai.direction})`;
}

/** Sell `count` contracts of `side` at no lower than `minCents` (IOC). */
async function sell(creds: { keyId: string; pem: string }, ticker: string, side: "yes" | "no", count: number, minCents: number) {
  // Selling YES = offering on the YES book (ask). Selling NO = bidding YES at 100-price.
  const book = mapOrderToBook(side, minCents);
  const r = await authedKalshi<{ order_id: string; fill_count: string }>(creds, "POST", "/portfolio/events/orders", {
    ticker,
    client_order_id: crypto.randomUUID(),
    side: book.side === "bid" ? "ask" : "bid",
    count: count.toFixed(2),
    price: book.price,
    time_in_force: "immediate_or_cancel",
    self_trade_prevention_type: "taker_at_cross",
    post_only: false,
    exchange_index: -1,
  });
  return { orderId: r.order_id, filled: Number(r.fill_count) || 0 };
}

type OpenRow = { id: string; pair: string; ticker: string; dir: string; strike_type: string; entry_price: number; contracts: number; candle_id: number };

async function manage(row: OpenRow, creds: { keyId: string; pem: string }, candleStart: number) {
  const sb = await db();
  const side: "yes" | "no" = (row.strike_type === "floor") === (row.dir === "UP") ? "yes" : "no";
  const raw = await fetchMarket(row.ticker);
  if (!raw) return null;
  const m = normalizeMarket(raw);
  const bid = Math.round((side === "yes" ? m.yesBid : m.noBid) * 100);
  const entry = Math.round(row.entry_price * 100);
  const elapsed = (Date.now() - candleStart) / 1000;
  let reason: string | null = null;
  if (bid >= entry + TAKE_PROFIT) reason = "profit";
  else if (bid > 0 && bid <= entry - STOP_LOSS) reason = "stop";
  else if (elapsed >= MAX_HOLD_UNTIL) reason = "time";
  if (!reason || bid <= 0) return null;
  try {
    const out = await sell(creds, row.ticker, side, row.contracts, Math.max(1, bid - 1));
    if (out.filled <= 0) return `${row.pair}: exit (${reason}) not filled at ${bid}¢`;
    const pnl = ((bid - entry) / 100) * out.filled;
    await sb
      .from("trade_log")
      .update({
        exit_price: bid / 100,
        exit_reason: reason,
        exit_at: new Date().toISOString(),
        exit_order_id: out.orderId,
        exit_contracts: out.filled,
        pnl,
        outcome: pnl >= 0 ? "win" : "loss",
        status: out.filled >= row.contracts ? "closed" : "placed",
        contracts: row.contracts - out.filled,
      } as never)
      .eq("id", row.id);
    return `${row.pair}: SOLD ${out.filled} @ ${bid}¢ (${reason}, ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)})`;
  } catch (e) {
    return `${row.pair}: exit error ${e instanceof Error ? e.message : ""}`;
  }
}

export async function runScalper() {
  const sb = await db();
  const { data: s } = await sb.from("bot_settings").select("scalp_enabled,auto_trade_size").eq("id", true).maybeSingle();
  if (!(s as { scalp_enabled?: boolean } | null)?.scalp_enabled) return { ok: true, msg: "scalper off" };
  const keyId = process.env["KALSHI_API_KEY_ID"];
  const pem = process.env["KALSHI_PRIVATE_KEY"];
  if (!keyId || !pem) return { ok: false, msg: "Kalshi key missing" };
  const creds = { keyId, pem };
  const size = Number(s?.auto_trade_size ?? 10);

  const t0 = Date.now();
  const candleStart = Math.floor(t0 / CANDLE_MS) * CANDLE_MS;
  const results: string[] = [];
  const tried = new Set<string>();

  while (Date.now() - t0 < RUN_MS) {
    const elapsed = (Date.now() - candleStart) / 1000;
    if (elapsed >= 900) break;
    // Entries
    if (elapsed >= ENTRY_FROM && elapsed < ENTRY_UNTIL) {
      for (const p of PAIRS) {
        if (tried.has(p)) continue;
        const { data: ex } = await sb.from("trade_log").select("id").eq("pair", p).eq("candle_id", candleStart).eq("source", "scalp").limit(1);
        if (ex?.length) {
          tried.add(p);
          continue;
        }
        const r = await enter(p, candleStart, size, creds);
        if (r !== null) {
          tried.add(p);
          results.push(r);
        }
      }
    }
    // Exits
    const { data: open } = await sb
      .from("trade_log")
      .select("id,pair,ticker,dir,strike_type,entry_price,contracts,candle_id")
      .eq("source", "scalp")
      .eq("status", "placed")
      .eq("candle_id", candleStart)
      .gt("contracts", 0);
    for (const row of (open ?? []) as OpenRow[]) {
      const r = await manage(row, creds, candleStart);
      if (r) results.push(r);
    }
    if (!open?.length && elapsed >= ENTRY_UNTIL) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const msg = results.length ? results.join(" · ") : "watching";
  await sb.from("bot_settings").update({ scalp_last_msg: `${new Date().toISOString().slice(11, 19)}Z ${msg}` } as never).eq("id", true);
  return { ok: true, msg };
}
