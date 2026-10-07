import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PRODUCT: Record<string, string> = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  XRP: "XRP-USD",
  DOGE: "DOGE-USD",
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Save (or update after a flip) the locked call for one coin's candle. */
export const recordLock = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        pair: z.enum(["BTC", "ETH", "SOL", "XRP", "DOGE"]),
        candle_start: z.number().int(),
        lock_sec: z.number().int().min(0).max(900),
        dir: z.enum(["UP", "DOWN"]),
        prob: z.number().min(0).max(100),
        open_price: z.number().positive(),
        lock_price: z.number().positive(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (data.candle_start + 900_000 < Date.now()) return { ok: false };
    const sb = await db();
    const { error } = await sb
      .from("direction_calls")
      .upsert({ ...data, locked_at: new Date().toISOString() }, { onConflict: "pair,candle_start" });
    if (error) console.error("recordLock", error);
    return { ok: !error };
  });

async function closeOf(pair: string, start: number): Promise<number | null> {
  const iso = (ms: number) => new Date(ms).toISOString();
  try {
    const r = await fetch(
      `https://api.exchange.coinbase.com/products/${PRODUCT[pair]}/candles?granularity=900&start=${iso(start)}&end=${iso(start + 900_000)}`,
      { headers: { "User-Agent": "coin-direction-reader" } },
    );
    if (!r.ok) return null;
    const rows = (await r.json()) as number[][];
    const row = rows.find((x) => (x[0] ?? 0) * 1000 === start);
    return row?.[4] ?? null;
  } catch {
    return null;
  }
}

/** Wipe the scorecard: delete every recorded direction call. */
export const resetScorecard = createServerFn({ method: "POST" }).handler(async () => {
  const sb = await db();
  const { error } = await sb.from("direction_calls").delete().gte("candle_start", 0);
  if (error) console.error("resetScorecard", error);
  return { ok: !error };
});

/** Grade finished candles, then return win rates by coin and by lock minute. */
export const getScorecard = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await db();
  const cutoff = Date.now() - 900_000 - 30_000;
  const { data: pending } = await sb
    .from("direction_calls")
    .select("id,pair,candle_start,dir,open_price")
    .is("result", null)
    .lt("candle_start", cutoff)
    .limit(20);
  for (const p of pending ?? []) {
    const close = await closeOf(p.pair, p.candle_start);
    if (close == null) continue;
    const up = close > p.open_price;
    const result = close === p.open_price ? "FLAT" : (p.dir === "UP") === up ? "WIN" : "LOSS";
    await sb
      .from("direction_calls")
      .update({ close_price: close, result, graded_at: new Date().toISOString() })
      .eq("id", p.id);
  }
  const { data: rows } = await sb
    .from("direction_calls")
    .select("pair,candle_start,lock_sec,dir,prob,result")
    .order("candle_start", { ascending: false })
    .limit(1000);
  const all = rows ?? [];
  const tally = (key: (r: (typeof all)[number]) => string) => {
    const m: Record<string, { wins: number; losses: number }> = {};
    for (const r of all) {
      if (r.result !== "WIN" && r.result !== "LOSS") continue;
      const k = key(r);
      m[k] ??= { wins: 0, losses: 0 };
      if (r.result === "WIN") m[k].wins++;
      else m[k].losses++;
    }
    return m;
  };
  return {
    byPair: tally((r) => r.pair),
    byMinute: tally((r) => String(Math.floor(r.lock_sec / 60))),
    recent: all.slice(0, 12),
  };
});
