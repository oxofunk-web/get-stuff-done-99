import { createServerFn } from "@tanstack/react-start";

/** MANUAL mode alerts: qualified setups the bot found this candle. No orders are ever sent. */
export const getTradeAlerts = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = Math.floor(Date.now() / 900_000) * 900_000 - 900_000;
  const { data } = await supabaseAdmin
    .from("trade_log")
    .select("id,pair,dir,candle_id,strike,entry_price,requested_contracts,stake,msg,ts")
    .eq("status", "alert")
    .gte("candle_id", since)
    .order("ts", { ascending: false })
    .limit(20);
  const { data: s } = await supabaseAdmin.from("bot_settings").select("auto_trade_last_msg").eq("id", true).maybeSingle();
  return {
    alerts: (data ?? []) as {
      id: string; pair: string; dir: string; candle_id: number; strike: number | null;
      entry_price: number | null; requested_contracts: number | null; stake: number | null; msg: string | null; ts: string;
    }[],
    lastMsg: (s as { auto_trade_last_msg?: string } | null)?.auto_trade_last_msg ?? "",
  };
});
