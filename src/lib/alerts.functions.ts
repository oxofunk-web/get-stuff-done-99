import { createServerFn } from "@tanstack/react-start";

/** Recent paper decisions and the simulated bank. */
export const getTradeAlerts = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("trade_log")
    .select("id,pair,dir,candle_id,strike,entry_price,requested_contracts,stake,msg,ts,status,contracts,outcome,pnl")
    .eq("mode", "paper")
    .eq("source", "lock")
    .order("ts", { ascending: false })
    .limit(20);
  const { data: s } = await supabaseAdmin.from("bot_settings").select("auto_trade_last_msg,paper_bankroll").eq("id", true).maybeSingle();
  return {
    alerts: (data ?? []) as {
      id: string; pair: string; dir: string; candle_id: number; strike: number | null;
      entry_price: number | null; requested_contracts: number | null; stake: number | null; msg: string | null; ts: string;
      status: string; contracts: number | null; outcome: string | null; pnl: number | null;
    }[],
    lastMsg: (s as { auto_trade_last_msg?: string } | null)?.auto_trade_last_msg ?? "",
    bankroll: Number(s?.paper_bankroll ?? 100),
  };
});
