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
        // ?mode=paper (default) | live | all
        const mode = url.searchParams.get("mode") ?? "paper";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let q = supabaseAdmin
          .from("trade_log")
          .select(
            "id,ts,mode,pair,dir,candle_id,contracts,entry_price,exit_price,exit_reason,stake,pnl,outcome,status,msg,settled_at,tp_trigger,lock_id",
          );
        if (mode === "live" || mode === "paper") q = q.eq("mode", mode);
        const res = await q.order("ts", { ascending: false }).limit(limit);
        if (res.error) return Response.json({ error: res.error.message }, { status: 500 });
        return Response.json({ trades: res.data ?? [] });
      },
    },
  },
});
