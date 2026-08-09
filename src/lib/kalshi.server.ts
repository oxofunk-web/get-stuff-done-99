const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const FALLBACK_BASE = "https://external-api.kalshi.com/trade-api/v2";

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
    closeTime: mkt.close_time ?? null,
  };
}

/** Public (unauthenticated) Kalshi read — proxied server-side to dodge CORS. */
export async function fetchOpenMarket(series: string): Promise<RawMarket | null> {
  const path = `/markets?series_ticker=${series}&status=open&limit=1`;
  for (const base of [KALSHI_BASE, FALLBACK_BASE]) {
    try {
      const r = await fetch(base + path, { headers: { accept: "application/json" } });
      if (!r.ok) continue;
      const j = (await r.json()) as { markets?: RawMarket[] };
      return j.markets?.[0] ?? null;
    } catch {
      // try next base
    }
  }
  return null;
}

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
        message?: string;
        error?: string | { code?: string; message?: string; details?: string };
      };
      const err = j.error;
      if (typeof err === "string") detail = err;
      else if (err && typeof err === "object")
        detail = [err.code, err.details].filter(Boolean).join(" · ");
      if (!detail && typeof j.message === "string") detail = j.message;
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