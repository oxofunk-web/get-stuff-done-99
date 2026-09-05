import { MAX_SLIPPAGE_CENTS } from "./bot/constants";
import { mapOrderToBook } from "./bot/order-map";
import { activeCandleCloseMs, marketMatchesActiveCandle } from "./bot/stability";

const KALSHI_BASE = "https://external-api.kalshi.com/trade-api/v2";
const FALLBACK_BASE = "https://api.elections.kalshi.com/trade-api/v2";

export interface RawMarket {
  ticker: string;
  floor_strike?: number;
  cap_strike?: number;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  yes_bid_size_fp?: string;
  yes_ask_size_fp?: string;
  volume?: number;
  volume_24h?: number;
  volume_24h_fp?: string;
  close_time?: string;
}

function toDollars(dollars: string | undefined, cents: number | undefined) {
  if (dollars !== undefined && dollars !== "") {
    const d = Number(dollars);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }
  const n = Number(cents ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

export function normalizeMarket(mkt: RawMarket) {
  const yesBid = toDollars(mkt.yes_bid_dollars, mkt.yes_bid);
  const yesAsk = toDollars(mkt.yes_ask_dollars, mkt.yes_ask);
  const noBid = toDollars(mkt.no_bid_dollars, mkt.no_bid);
  const noAsk = toDollars(mkt.no_ask_dollars, mkt.no_ask);
  const yesMid = (yesBid + yesAsk) / 2 || 0.5;
  return {
    ticker: mkt.ticker,
    strike: mkt.floor_strike ?? mkt.cap_strike ?? null,
    yesBid,
    yesAsk,
    noBid: noBid || Math.max(0, 1 - yesAsk),
    noAsk: noAsk || Math.max(0, 1 - yesBid),
    yesMid,
    spread: Math.max(0, yesAsk - yesBid),
    vol: Number(mkt.volume_24h_fp ?? mkt.volume_24h ?? mkt.volume ?? 0) || 0,
    yesAskSize: Math.floor(Number(mkt.yes_ask_size_fp ?? 0) || 0),
    yesBidSize: Math.floor(Number(mkt.yes_bid_size_fp ?? 0) || 0),
    closeTime: mkt.close_time ?? null,
  };
}

/**
 * Public (unauthenticated) Kalshi read — proxied server-side to dodge CORS.
 *
 * A 15-minute series usually has more than one market in `open` status around a
 * rollover (the candle that is settling and the one that just opened). Taking
 * `limit=1` returned whichever the API listed first, so scoring and order
 * pricing could land on two DIFFERENT candles — that is what produced "quote
 * moved 71¢ -> 88¢" skips and nonsense signals. Always pick the open market
 * that closes soonest in the future: the candle currently being traded.
 */
export async function fetchOpenMarket(
  series: string,
  spot?: number | null,
  now = Date.now(),
): Promise<RawMarket | null> {
  const path = `/markets?series_ticker=${series}&status=open&limit=200`;
  for (const base of [KALSHI_BASE, FALLBACK_BASE]) {
    try {
      const r = await fetch(base + path, { headers: { accept: "application/json" } });
      if (!r.ok) continue;
      const j = (await r.json()) as { markets?: RawMarket[] };
      const markets = j.markets ?? [];
      if (!markets.length) continue;
      const upcoming = markets
        .map((m) => ({ m, close: m.close_time ? new Date(m.close_time).getTime() : NaN }))
        .filter((x) => Number.isFinite(x.close) && x.close > now)
        .sort((a, b) => a.close - b.close);
      // The API briefly exposes the closing and next contracts together. Only
      // accept the contract whose close matches our active UTC quarter-hour.
      const candle = upcoming
        .filter((x) => marketMatchesActiveCandle(x.m.close_time, now))
        .map((x) => x.m);
      if (!candle.length) return null;
      // Pick deterministically by strike proximity. Re-ranking by live midpoint
      // made the selected contract jump as prices moved.
      const score = (m: RawMarket) => {
        const strike = m.floor_strike ?? m.cap_strike ?? null;
        if (spot && strike != null) return Math.abs(strike - spot) / spot;
        return Math.abs(normalizeMarket(m).yesMid - 0.5);
      };
      return candle.reduce((best, m) => {
        const delta = score(m) - score(best);
        return delta < 0 || (delta === 0 && m.ticker < best.ticker) ? m : best;
      }, candle[0]!);
    } catch {
      // try next base
    }
  }
  return null;
}

/** Exposed for regression tests and diagnostics. */
export { activeCandleCloseMs };


/** Fresh single-market snapshot (best bid/ask + resting size at top of book). */
export async function fetchMarket(ticker: string): Promise<RawMarket | null> {
  for (const base of [KALSHI_BASE, FALLBACK_BASE]) {
    try {
      const r = await fetch(`${base}/markets/${encodeURIComponent(ticker)}`, {
        headers: { accept: "application/json" },
      });
      if (!r.ok) continue;
      const j = (await r.json()) as { market?: RawMarket };
      return j.market ?? null;
    } catch {
      // try next base
    }
  }
  return null;
}

function derLength(n: number) {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/** Wrap a PKCS#1 RSAPrivateKey DER in a PKCS#8 PrivateKeyInfo. */
function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const algId = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const octet = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const version = [0x02, 0x01, 0x00];
  const bodyLen = version.length + algId.length + octet.length;
  const out = new Uint8Array([0x30, ...derLength(bodyLen), ...version, ...algId, ...octet]);
  return out;
}

function pemToDer(pem: string) {
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  const b64 = pem
    .replace(/-----[^-]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return isPkcs1 ? pkcs1ToPkcs8(der) : der;
}

async function signHeaders(keyId: string, pem: string, method: string, path: string) {
  const ts = Date.now().toString();
  const signPath = "/trade-api/v2" + path.split("?")[0];
  const msg = new TextEncoder().encode(ts + method.toUpperCase() + signPath);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem).buffer as ArrayBuffer,
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, key, msg);
  let sig = "";
  const bytes = new Uint8Array(sigBuf);
  for (let i = 0; i < bytes.length; i++) sig += String.fromCharCode(bytes[i]!);
  return {
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": btoa(sig),
  };
}

export async function authedKalshi<T>(
  creds: { keyId: string; pem: string },
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const headers = await signHeaders(creds.keyId, creds.pem, method, path);
  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(KALSHI_BASE + path, init);
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as {
        code?: string;
        message?: string;
        details?: string;
        error?: string | { code?: string; message?: string; details?: string };
      };
      // Current Kalshi errors are flat; retain nested parsing for older replies.
      detail = [j.code, j.message, j.details].filter(Boolean).join(" · ");
      if (!detail) {
        const err = j.error;
        if (typeof err === "string") detail = err;
        else if (err && typeof err === "object")
          detail = [err.code, err.message, err.details].filter(Boolean).join(" · ");
      }
    } catch {
      detail = await res.text().catch(() => "");
    }
    if (typeof detail !== "string") detail = String(detail);
    if (res.status === 401) {
      throw new Error(
        `Kalshi rejected the API key (401${detail ? ` — ${detail}` : ""}). The key ID may be revoked or paired with a different private key — generate a new key pair in Kalshi → Account → API Keys and re-save both values.`,
      );
    }
    throw new Error(`Kalshi ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

export interface AccountPosition {
  ticker: string;
  count: number;
  exposure: number;
  realized: number;
}

interface RawPosition {
  ticker: string;
  position?: number;
  market_exposure?: number;
  realized_pnl?: number;
  position_fp?: string;
  market_exposure_dollars?: string;
  realized_pnl_dollars?: string;
  fees_paid_dollars?: string;
}

function dollars(dollarStr: string | undefined, cents: number | undefined) {
  if (dollarStr !== undefined && dollarStr !== "") {
    const amount = Number(dollarStr);
    if (Number.isFinite(amount)) return amount;
  }
  const amount = Number(cents ?? 0);
  return Number.isFinite(amount) ? amount / 100 : 0;
}

export async function fetchLiveBalance(creds: { keyId: string; pem: string }) {
  const balance = await authedKalshi<{ balance?: number; balance_dollars?: string }>(
    creds,
    "GET",
    "/portfolio/balance",
  );
  return dollars(balance.balance_dollars, balance.balance);
}

export async function fetchPortfolioSnapshot(creds: { keyId: string; pem: string }) {
  const [balance, result] = await Promise.all([
    fetchLiveBalance(creds),
    authedKalshi<{ market_positions?: RawPosition[] }>(
      creds,
      "GET",
      "/portfolio/positions?count_filter=position&limit=200",
    ),
  ]);
  const positions: AccountPosition[] = (result.market_positions ?? [])
    .map((position) => ({
      ticker: position.ticker,
      count:
        position.position_fp !== undefined ? Number(position.position_fp) : (position.position ?? 0),
      exposure: dollars(position.market_exposure_dollars, position.market_exposure),
      realized:
        dollars(position.realized_pnl_dollars, position.realized_pnl) -
        dollars(position.fees_paid_dollars, undefined),
    }))
    .filter((position) => position.count !== 0 || position.exposure !== 0);

  return {
    balance,
    positions,
    realized: positions.reduce((total, position) => total + position.realized, 0),
    exposure: positions.reduce((total, position) => total + position.exposure, 0),
  };
}

function friendlyOrderError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Order rejected";
  if (/insufficient_balance/i.test(raw))
    return "Insufficient Kalshi balance for this bet size — lower the stake or deposit funds.";
  if (/resting_volume/i.test(raw))
    return "Not enough resting volume to fill — the book is too thin right now.";
  if (/market_not_open|not_active|closed/i.test(raw))
    return "That 15-minute market is no longer accepting orders.";
  return raw;
}

interface PlaceLiveOrderInput {
  ticker: string;
  side: "yes" | "no";
  /** Price the signal was scored at (cents, on the ordered side's scale). */
  priceCents: number;
  count: number;
  /** Hard slippage ceiling. Defaults to scored price + MAX_SLIPPAGE_CENTS. */
  maxPriceCents?: number | undefined;
  /** Exact ticker quote already refreshed by the engine immediately before submission. */
  quote?: ReturnType<typeof normalizeMarket> | undefined;
}

interface CreateOrderResponse {
  order_id: string;
  fill_count: string;
  remaining_count: string;
  average_fill_price?: string;
}

/**
 * Kalshi reports `average_fill_price` on the YES scale, and the units have
 * shifted between dollars and cents across API revisions — normalize both, then
 * translate back onto the side we actually bought.
 */
export function normalizeFillCents(raw: unknown, side: "yes" | "no") {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const yesCents = n <= 1 ? n * 100 : n;
  const paid = side === "yes" ? yesCents : 100 - yesCents;
  if (paid <= 0 || paid > 100) return null;
  return Math.round(paid);
}

/**
 * Single-shot IOC order with a hard slippage cap. No retry loop: chasing a
 * moving touch is how the engine used to fill 14¢ above the scored price and
 * throw away the whole edge. If the book has moved past the cap, we skip.
 */
export async function placeLiveOrder(
  creds: { keyId: string; pem: string },
  input: PlaceLiveOrderInput,
) {
  try {
    const ceiling = Math.min(
      99,
      Math.max(1, input.maxPriceCents ?? input.priceCents + MAX_SLIPPAGE_CENTS),
    );
    const fresh = input.quote ? null : await fetchMarket(input.ticker);
    const market = input.quote ?? (fresh ? normalizeMarket(fresh) : null);
    const quoteCents = market
      ? Math.round((input.side === "yes" ? market.yesAsk : market.noAsk) * 100)
      : 0;

    if (quoteCents > ceiling) {
      return {
        ok: false as const,
        error: `Quote moved — ${input.side.toUpperCase()} is now ${quoteCents}¢ vs the ${input.priceCents}¢ the signal was scored at (cap ${ceiling}¢). Skipped instead of chasing.`,
      };
    }

    const limitCents = Math.min(ceiling, Math.max(1, Math.max(quoteCents, input.priceCents)));
    // Depth resting at the touch on the side we're taking, in contracts.
    const restingSize = Math.floor(
      input.side === "yes" ? market?.yesAskSize ?? 0 : market?.yesBidSize ?? 0,
    );
    if (restingSize === 0) {
      return {
        ok: false as const,
        error: "Book too thin — nothing resting at the live price, so no order was sent.",
      };
    }
    const count = Math.max(1, Math.min(input.count, restingSize));

    // side + price flip are one coupled decision — see order-map.ts
    const book = mapOrderToBook(input.side, limitCents);
    const response = await authedKalshi<CreateOrderResponse>(
      creds,
      "POST",
      "/portfolio/events/orders",
      {
        ticker: input.ticker,
        client_order_id: crypto.randomUUID(),
        side: book.side,
        count: count.toFixed(2),
        price: book.price,
        time_in_force: "immediate_or_cancel",
        self_trade_prevention_type: "taker_at_cross",
        post_only: false,
        exchange_index: -1,
      },
    );
    const filled = Number(response.fill_count);
    if (Number.isFinite(filled) && filled > 0) {
      const fillCents = normalizeFillCents(response.average_fill_price, input.side) ?? limitCents;
      return {
        ok: true as const,
        orderId: response.order_id,
        filled,
        /** Actual average price paid — used for stake and P&L. */
        priceCents: fillCents,
        limitCents,
        status: `filled ${filled} @ ${fillCents}¢`,
      };
    }
    return {
      ok: false as const,
      error: `No fill at ${limitCents}¢ — the resting size vanished before the order landed. Not chasing it.`,
    };
  } catch (error) {
    console.error("Kalshi order failed", error);
    return { ok: false as const, error: friendlyOrderError(error) };
  }
}
