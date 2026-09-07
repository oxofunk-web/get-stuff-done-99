import { createServerFn } from "@tanstack/react-start";

/**
 * Nightly coach: reads the last day of decisions and outcomes and reports, in
 * plain English, which gate cost money, which pair to stop trading, and which
 * setting to change — always with the numbers behind the claim. Nothing it says
 * is applied automatically; every recommendation is a proposal.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface CoachNote {
  ok: boolean;
  ts?: string;
  headline?: string;
  findings?: { claim: string; evidence: string; action: string }[];
  error?: string;
}

/** The most recent coach report, if one exists. */
export const getCoachNote = createServerFn({ method: "GET" }).handler(async (): Promise<CoachNote> => {
  try {
    const db = await admin();
    const { data } = await db
      .from("ai_notes")
      .select("ts, label, data")
      .eq("kind", "coach")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return { ok: false, error: "No coach report yet." };
    const row = data as unknown as {
      ts: string;
      label: string | null;
      data: { findings?: { claim: string; evidence: string; action: string }[] } | null;
    };
    return {
      ok: true,
      ts: row.ts,
      headline: row.label ?? "",
      findings: row.data?.findings ?? [],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Coach report unavailable" };
  }
});

/** Build a fresh coach report from the last 24 hours of recorded decisions. */
export const runCoach = createServerFn({ method: "POST" }).handler(async (): Promise<CoachNote> => {
  const db = await admin();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const { data: sigRows } = await db
    .from("signal_log")
    .select("pair, verdict, reason, conf, entry_price, ev, sigma_dist, minute_in, outcome")
    .eq("source", "server")
    .gte("ts", since)
    .limit(20000);
  const { data: tradeRows } = await db
    .from("trade_log")
    .select("pair, dir, conf, entry_price, stake, pnl, status, outcome, msg")
    .eq("source", "server")
    .gte("ts", since)
    .limit(5000);

  const signals = (sigRows ?? []) as {
    pair: string;
    verdict: string;
    reason: string | null;
    conf: number | null;
    entry_price: number | null;
    outcome: string | null;
  }[];
  const trades = (tradeRows ?? []) as {
    pair: string;
    entry_price: number | null;
    pnl: number | null;
    status: string;
    outcome: string | null;
    msg: string | null;
  }[];

  const byReason = new Map<string, { n: number; settled: number; wins: number }>();
  for (const r of signals) {
    if (r.verdict === "fired") continue;
    const key = (r.reason ?? "unknown").slice(0, 60);
    const e = byReason.get(key) ?? { n: 0, settled: 0, wins: 0 };
    e.n += 1;
    if (r.outcome === "win" || r.outcome === "loss") {
      e.settled += 1;
      if (r.outcome === "win") e.wins += 1;
    }
    byReason.set(key, e);
  }

  const byPair = new Map<string, { fills: number; wins: number; pnl: number; entrySum: number }>();
  for (const t of trades) {
    if (t.status !== "placed") continue;
    const e = byPair.get(t.pair) ?? { fills: 0, wins: 0, pnl: 0, entrySum: 0 };
    e.fills += 1;
    if (t.outcome === "win") e.wins += 1;
    e.pnl += t.pnl ?? 0;
    e.entrySum += t.entry_price ?? 0;
    byPair.set(t.pair, e);
  }

  const summary = {
    windowHours: 24,
    decisions: signals.length,
    fired: signals.filter((s) => s.verdict === "fired").length,
    fills: trades.filter((t) => t.status === "placed").length,
    failedOrders: trades.filter((t) => t.status === "failed").length,
    settledPnl: Number(
      trades.reduce((a, t) => a + (t.outcome === "void" ? 0 : (t.pnl ?? 0)), 0).toFixed(2),
    ),
    topBlockers: [...byReason.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 10)
      .map(([reason, v]) => ({
        reason,
        count: v.n,
        settled: v.settled,
        wouldHaveWonPct: v.settled ? Math.round((v.wins / v.settled) * 100) : null,
      })),
    perPair: [...byPair.entries()].map(([pair, v]) => ({
      pair,
      fills: v.fills,
      winPct: v.fills ? Math.round((v.wins / v.fills) * 100) : 0,
      pnl: Number(v.pnl.toFixed(2)),
      avgEntryCents: v.fills ? Math.round((v.entrySum / v.fills) * 100) : null,
    })),
  };

  const { askForJson } = await import("./ai.server");
  const result = await askForJson<{
    headline: string;
    findings: { claim: string; evidence: string; action: string }[];
  }>({
    schemaName: "coach_report",
    system:
      "You review a 15-minute crypto binary-options trading bot's own recorded results. " +
      "Be blunt and quantitative. Breakeven win rate equals the entry price, so a 72c average " +
      "entry needs a 72% hit rate. Only make claims the numbers support, cite the numbers in the " +
      "evidence field, and never invent data. Write for a non-programmer.",
    user: `Here is the last 24 hours of this bot's decisions and outcomes as JSON:\n${JSON.stringify(summary)}\n\nReport the few things that most likely cost money, with the numbers behind each, and one concrete setting or pair change per finding.`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "findings"],
      properties: {
        headline: { type: "string" },
        findings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["claim", "evidence", "action"],
            properties: {
              claim: { type: "string" },
              evidence: { type: "string" },
              action: { type: "string" },
            },
          },
        },
      },
    },
  });

  if (!result.ok || !result.data) return { ok: false, error: result.error ?? "Coach failed" };

  const ts = new Date().toISOString();
  await db.from("ai_notes").insert({
    kind: "coach",
    label: result.data.headline,
    note: result.data.findings.map((f) => `${f.claim} — ${f.evidence} → ${f.action}`).join("\n"),
    data: { findings: result.data.findings, summary },
  });

  return { ok: true, ts, headline: result.data.headline, findings: result.data.findings };
});
