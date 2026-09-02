/**
 * Pull the recorded market tape (`market_snapshots`) for offline replay.
 * Uses the service-role key from the environment; nothing here is bundled into
 * the app.
 */
import type { SnapshotRow } from "../src/lib/bot/replay";

const PAGE = 10000;

export async function loadSnapshots(hours: number): Promise<SnapshotRow[]> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const out: SnapshotRow[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const endpoint =
      `${url}/rest/v1/market_snapshots` +
      `?select=ts,candle_id,seconds_in,pair,ticker,spot,strike,yes_bid,yes_ask,yes_mid,spread,vol` +
      `&ts=gte.${since}&order=ts.asc&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(endpoint, {
      headers: { apikey: key, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`snapshots ${res.status} ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as SnapshotRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
