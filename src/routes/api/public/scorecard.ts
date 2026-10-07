import { createFileRoute } from "@tanstack/react-router";

/** Public read-only: 50 most recent direction calls, newest first. */
export const Route = createFileRoute("/api/public/scorecard")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const [callsRes, settingsRes] = await Promise.all([
          supabaseAdmin.from("direction_calls").select("*").order("locked_at", { ascending: false }).limit(50),
          supabaseAdmin
            .from("bot_settings")
            .select("last_tick_at,auto_trade_last_msg,updated_at")
            .eq("id", true)
            .maybeSingle(),
        ]);
        if (callsRes.error) return Response.json({ error: callsRes.error.message }, { status: 500 });
        const s = settingsRes.data ?? {};
        return Response.json({
          calls: callsRes.data ?? [],
          heartbeat: {
            at: s.last_tick_at ?? null,
            msg: s.auto_trade_last_msg ?? null,
            updated_at: s.updated_at ?? null,
          },
        });
      },
    },
  },
});
