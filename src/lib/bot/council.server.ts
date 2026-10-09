/**
 * Council live-trading system. Fully separate from the main 15-min engine:
 * its own budget ($10/day), own loss halt, own rows (trade_log.council=true,
 * source="council"). The main engine's cap only counts source="lock".
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { PAPER_FEE } from "./autotrade.server";

export const COUNCIL_DAILY_BUDGET = 10;
export const COUNCIL_DAILY_LOSS_HALT = 10;
export const COUNCIL_MAX_OPEN = 3;
export const COUNCIL_STAKE = 5;
export const COUNCIL_MARKET_RE = /^KX(BTC|ETH|SOL|XRP|DOGE)15M-/;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
type Sb = Awaited<ReturnType<typeof db>>;

/** Bearer token check against council_settings.api_token. Returns a 401 Response on failure. */
export async function authCouncil(request: Request): Promise<Response | null> {
  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (token) {
    const sb = await db();
    const { data } = await sb.from("council_settings").select("api_token").eq("id", true).maybeSingle();
    const d = (v: string) => createHash("sha256").update(v, "utf8").digest();
    if (data?.api_token && timingSafeEqual(d(token), d(data.api_token))) return null;
  }
  return new Response("Unauthorized", { status: 401 });
}

const dayStartIso = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};

/** Today's council money: spent stake, settled P&L, open positions. Live council rows only. */
export async function councilDay(sb: Sb) {
  const { data } = await sb
    .from("trade_log")
    .select("ticker,stake,pnl,outcome,status")
    .eq("council", true)
    .eq("mode", "live")
    .gte("ts", dayStartIso());
  const rows = (data ?? []).filter((r) => r.status === "placed");
  const spent = rows.reduce((a, r) => a + Number(r.stake ?? 0), 0);
  const pnl = rows.reduce((a, r) => a + (r.outcome === "void" ? 0 : Number(r.pnl ?? 0)), 0);
  const { data: openRows } = await sb
    .from("trade_log")
    .select("ticker")
    .eq("council", true)
    .eq("mode", "live")
    .eq("status", "placed")
    .is("outcome", null);
  const open = (openRows ?? []).map((r) => r.ticker).filter(Boolean) as string[];
  return { spent, pnl, open };
}

export async function councilHalt(sb: Sb) {
  const { data } = await sb.from("council_settings").select("halted").eq("id", true).maybeSingle();
  return !!data?.halted;
}

interface Proposal {
  id: string;
  proposing_agent: string;
  market: string;
  side: string;
  entry_target: number;
  confidence: number;
  expires_at: string;
  status: string;
}

/** The Bank: final veto. Returns approve + exact reason + numbers used. */
export async function bankGate(sb: Sb, p: Proposal) {
  const checks: Record<string, unknown> = {};
  const reject = (reason: string) => ({ approve: false as const, reason, checks, at: new Date().toISOString() });
  if (await councilHalt(sb)) return reject("council halted (HALT COUNCIL is on)");
  if (new Date(p.expires_at).getTime() <= Date.now()) return reject("proposal expired");
  if (!COUNCIL_MARKET_RE.test(p.market)) return reject("not a crypto 15-min market");
  const day = await councilDay(sb);
  checks.day = day;
  if (day.pnl <= -COUNCIL_DAILY_LOSS_HALT)
    return reject(`council daily loss $${(-day.pnl).toFixed(2)} hit the $${COUNCIL_DAILY_LOSS_HALT} halt — paused until next UTC day`);
  if (day.spent + COUNCIL_STAKE > COUNCIL_DAILY_BUDGET + 1e-9)
    return reject(`council daily budget: $${day.spent.toFixed(2)} spent + $${COUNCIL_STAKE} would exceed $${COUNCIL_DAILY_BUDGET}`);
  if (day.open.includes(p.market)) return reject(`conflicting open council position on ${p.market}`);
  if (day.open.length >= COUNCIL_MAX_OPEN) return reject(`${day.open.length} council positions open (max ${COUNCIL_MAX_OPEN})`);
  const { fetchMarket, normalizeMarket } = await import("../kalshi.server");
  const raw = await fetchMarket(p.market);
  if (!raw) return reject("market not found on Kalshi");
  const m = normalizeMarket(raw);
  if (m.closeTime && new Date(m.closeTime).getTime() <= Date.now()) return reject("market already closed");
  const askCents = Math.round((p.side === "yes" ? m.yesAsk : m.noAsk) * 100);
  const priceCents = Math.min(p.entry_target, askCents);
  checks.askCents = askCents;
  if (!(askCents > 0 && askCents < 100)) return reject("no ask on that side");
  if (askCents > p.entry_target) return reject(`ask ${askCents}¢ above entry target ${p.entry_target}¢`);
  const q = priceCents / 100;
  const pWin = Number(p.confidence);
  const W = 1 - q - PAPER_FEE;
  const L = q + PAPER_FEE;
  const net = pWin * W - (1 - pWin) * L;
  checks.netEdgeCents = +(net * 100).toFixed(2);
  if (!(net > 0)) return reject(`fee-adjusted edge ${(net * 100).toFixed(1)}¢ does not survive the 14¢ round-trip`);
  const contracts = Math.floor(COUNCIL_STAKE / q);
  if (contracts < 1) return reject("$5 buys less than 1 contract");
  checks.contracts = contracts;
  return { approve: true as const, reason: "approved", checks, priceCents, contracts, at: new Date().toISOString() };
}

/** Execute a bank-approved proposal as a REAL Kalshi order. Re-runs the bank first. */
export async function executeProposal(id: string) {
  const sb = await db();
  const { data: p } = await sb.from("council_proposals").select("*").eq("id", id).maybeSingle();
  if (!p) return { ok: false, error: "proposal not found", status: 404 };
  if (p.status !== "bank_approved") return { ok: false, error: `status is ${p.status}, needs bank_approved`, status: 409 };
  const { fetchMarket, normalizeMarket, placeLiveOrder } = await import("../kalshi.server");
  const raw = await fetchMarket(p.market);
  const m = raw ? normalizeMarket(raw) : null;
  const closeMs = m?.closeTime ? new Date(m.closeTime).getTime() : NaN;
  const candleId = Number.isFinite(closeMs) ? closeMs - 900_000 : Math.floor(Date.now() / 900_000) * 900_000;
  const pair = /^KX([A-Z]+)15M/.exec(p.market)?.[1] ?? "?";
  const base = {
    candle_id: candleId, pair, dir: p.side.toUpperCase(), mode: "live", source: "council", council: true,
    agent: p.proposing_agent, proposal_id: p.id, ticker: p.market, strike: m?.strike ?? null,
    strike_type: m?.strikeType ?? null, conf: Number(p.confidence) * 100,
  };
  const skip = async (msg: string, extra: Record<string, unknown> = {}) => {
    const { error } = await sb.from("trade_log").insert({ ...base, status: "skipped", msg, ...extra } as never);
    if (error) console.error(`[council] trade_log insert failed: ${error.message}`);
    await sb.from("council_proposals").update({ order_error: msg, updated_at: new Date().toISOString() }).eq("id", p.id);
    return { ok: false, error: msg, status: 200 };
  };
  const gate = await bankGate(sb, p);
  if (!gate.approve) {
    await sb.from("council_proposals").update({ status: "bank_rejected", bank_decision: gate as never, updated_at: new Date().toISOString() }).eq("id", p.id);
    return skip(`Bank: ${gate.reason}`);
  }
  const keyId = process.env["KALSHI_API_KEY_ID"];
  const pem = process.env["KALSHI_PRIVATE_KEY"];
  if (!keyId || !pem) return skip("Kalshi key missing");
  const attempt = { entry_price: gate.priceCents / 100, requested_contracts: gate.contracts };
  const res = await placeLiveOrder(
    { keyId, pem },
    { ticker: p.market, side: p.side as "yes" | "no", priceCents: gate.priceCents, maxPriceCents: p.entry_target, count: gate.contracts, quote: m ?? undefined },
  );
  if (!res.ok) return skip(res.error ?? "no fill", attempt);
  const entry = res.priceCents / 100;
  const stake = res.filled * entry;
  const { data: row, error } = await sb
    .from("trade_log")
    .insert({ ...base, ...attempt, status: "placed", msg: res.status, order_id: res.orderId, contracts: res.filled, entry_price: entry, stake } as never)
    .select("id")
    .single();
  if (error) console.error(`[council] trade_log fill insert failed: ${error.message}`);
  await sb.from("council_proposals").update({
    status: "executed", order_id: res.orderId, contracts: res.filled, fill_price: entry, stake,
    filled_at: new Date().toISOString(), trade_id: row?.id ?? null, candle_id: candleId, order_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", p.id);
  return { ok: true, filled: res.filled, priceCents: res.priceCents, orderId: res.orderId, status: 200 };
}

/** Grade executed council trades once Kalshi finalizes the market. Idempotent. */
export async function gradeCouncil() {
  const sb = await db();
  const { fetchFinalizedMarketResult } = await import("../kalshi.server");
  const { data: rows } = await sb
    .from("council_proposals")
    .select("id,market,side,contracts,fill_price,trade_id,candle_id")
    .eq("status", "executed")
    .lt("candle_id", Date.now() - 900_000)
    .limit(20);
  let graded = 0;
  for (const p of rows ?? []) {
    const final = await fetchFinalizedMarketResult(p.market);
    if (!final) continue;
    const won = final.result === p.side;
    const n = Number(p.contracts ?? 0);
    const e = Number(p.fill_price ?? 0);
    const pnl = won ? n * (1 - e) : -n * e;
    const at = new Date().toISOString();
    if (p.trade_id) {
      await sb.from("trade_log").update({ outcome: won ? "win" : "loss", pnl, settled_at: at }).eq("id", p.trade_id).is("outcome", null);
    }
    await sb.from("council_proposals").update({ status: "graded", outcome: won ? "win" : "loss", pnl, graded_at: at, updated_at: at }).eq("id", p.id);
    graded++;
  }
  return { graded };
}

export async function councilState() {
  const sb = await db();
  const [{ data: proposals }, day, halted] = await Promise.all([
    sb.from("council_proposals").select("*").order("created_at", { ascending: false }).limit(30),
    councilDay(sb),
    councilHalt(sb),
  ]);
  return {
    halted,
    lossHalted: day.pnl <= -COUNCIL_DAILY_LOSS_HALT,
    spent: day.spent,
    pnl: day.pnl,
    open: day.open.length,
    budget: COUNCIL_DAILY_BUDGET,
    proposals: (proposals ?? []).map((p) => ({ ...p, api_token: undefined })),
  };
}
