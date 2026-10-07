import { createFileRoute } from "@tanstack/react-router";

/** Public read-only: 200 most recent paper trades, newest first. */
export const Route = createFileRoute("/api/public/trades")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const rawLimit = Number(url.searchParams.get("limit"));
        const limit = Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(Math.floor(rawLimit), 500)
          : 200;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const res = await supabaseAdmin
          .from("trade_log")
          .select(
            "id,pair,dir,candle_id,contracts,entry_price,exit_price,exit_reason,stake,pnl,outcome,status,settled_at",
          )
          .eq("mode", "paper")
          .order("ts", { ascending: false })
          .limit(limit);
        if (res.error) return Response.json({ error: res.error.message }, { status: 500 });
        return Response.json({ trades: res.data ?? [] });
      },
    },
  },
});
