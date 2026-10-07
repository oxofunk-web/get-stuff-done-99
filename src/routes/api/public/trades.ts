import { createFileRoute } from "@tanstack/react-router";

/** Public read-only: 200 most recent paper trades, newest first. */
export const Route = createFileRoute("/api/public/trades")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const res = await supabaseAdmin
          .from("trade_log")
          .select(
            "id,pair,dir,candle_id,contracts,entry_price,exit_price,exit_reason,stake,pnl,outcome,status,settled_at",
          )
          .eq("mode", "paper")
          .order("ts", { ascending: false })
          .limit(200);
        if (res.error) return Response.json({ error: res.error.message }, { status: 500 });
        return Response.json({ trades: res.data ?? [] });
      },
    },
  },
});
