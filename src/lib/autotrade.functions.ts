import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function state() {
  const sb = await db();
  const { data: s } = await sb
    .from("bot_settings")
    .select("auto_trade_enabled,auto_trade_size,auto_trade_last_msg")
    .eq("id", true)
    .maybeSingle();
  const since = Math.floor(Date.now() / 900_000) * 900_000 - 900_000 * 4;
  const { data: trades } = await sb
    .from("trade_log")
    .select("pair,candle_id,dir,status,msg,entry_price,contracts,outcome,pnl")
    .eq("source", "lock")
    .gte("candle_id", since)
    .order("ts", { ascending: false })
    .limit(20);
  return {
    enabled: !!s?.auto_trade_enabled,
    size: Number(s?.auto_trade_size ?? 10),
    lastMsg: s?.auto_trade_last_msg ?? null,
    trades: trades ?? [],
  };
}

export const getAutoTrade = createServerFn({ method: "GET" }).handler(state);

export const setAutoTrade = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        enabled: z.boolean().optional(),
        size: z.union([z.literal(10), z.literal(45), z.literal(100)]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sb = await db();
    const patch: { auto_trade_enabled?: boolean; auto_trade_size?: number } = {};
    if (data.enabled !== undefined) patch.auto_trade_enabled = data.enabled;
    if (data.size !== undefined) patch.auto_trade_size = data.size;
    await sb.from("bot_settings").update(patch).eq("id", true);
    return state();
  });
