/**
 * Daily loss-cap accounting for live trades.
 * The locked-call engine stops for the day once today's settled live P&L
 * plus unsettled open risk reaches the cap. Paper trades never count —
 * only mode="live" rows are included.
 */
export interface DayRisk {
  dayPnl: number;
  openRisk: number;
  breached: boolean;
}

type Db = {
  // Supabase query builder chain; typed loosely because the generated client
  // types don't survive the structural cast. Runtime shape is what matters.
  from(table: string): unknown;
};

export async function dayRisk(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  cap: number,
  sources: string[],
): Promise<DayRisk> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: dayRows } = await sb
    .from("trade_log")
    .select("pnl, stake, status, outcome")
    .in("source", sources)
    .eq("mode", "live")
    .gte("ts", dayStart.toISOString());
  const riskRows = (dayRows ?? []) as {
    pnl: number | null;
    stake: number | null;
    status: string;
    outcome: string | null;
  }[];
  const dayPnl = riskRows.reduce((a, r) => a + (r.outcome === "void" ? 0 : r.pnl ?? 0), 0);
  const openRisk = riskRows.reduce(
    (a, r) => a + (r.status === "placed" && r.outcome == null ? Math.max(0, r.stake ?? 0) : 0),
    0,
  );
  return { dayPnl, openRisk, breached: dayPnl - openRisk <= -cap };
}
