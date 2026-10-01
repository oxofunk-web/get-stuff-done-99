import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function state() {
  const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
  const { data: s } = await sb.from("bot_settings").select("scalp_enabled,scalp_last_msg,auto_trade_size").eq("id", true).maybeSingle();
  const since = Math.floor(Date.now() / 900_000) * 900_000 - 900_000 * 8;
  const { data: trades } = await sb
    .from("trade_log")
    .select("id,pair,candle_id,dir,status,msg,entry_price,exit_price,exit_reason,contracts,pnl")
    .eq("source", "scalp")
    .gte("candle_id", since)
    .order("ts", { ascending: false })
    .limit(16);
  const row = s as { scalp_enabled?: boolean; scalp_last_msg?: string | null; auto_trade_size?: number } | null;
  return {
    enabled: !!row?.scalp_enabled,
    lastMsg: row?.scalp_last_msg ?? null,
    size: Number(row?.auto_trade_size ?? 10),
    trades: trades ?? [],
  };
}

export const getScalp = createServerFn({ method: "GET" }).handler(state);

export const setScalp = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
    await sb.from("bot_settings").update({ scalp_enabled: data.enabled } as never).eq("id", true);
    return state();
  });
