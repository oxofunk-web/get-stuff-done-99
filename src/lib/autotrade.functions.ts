import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getBotSettings, updateBotSettings } from "./bot/settings.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function state() {
  const sb = await db();
  const s = await getBotSettings(sb);
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
    /** True = simulated fills, no real orders. Defaults to true (safe). */
    paper: s?.auto_trade_paper ?? true,
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
        paper: z.boolean().optional(),
        size: z.number().int().min(1).max(10000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sb = await db();
    const patch: { auto_trade_enabled?: boolean; auto_trade_paper?: boolean; auto_trade_size?: number } = {};
    if (data.enabled !== undefined) patch.auto_trade_enabled = data.enabled;
    if (data.paper !== undefined) patch.auto_trade_paper = data.paper;
    if (data.size !== undefined) patch.auto_trade_size = data.size;
    await updateBotSettings(sb, patch);
    return state();
  });
