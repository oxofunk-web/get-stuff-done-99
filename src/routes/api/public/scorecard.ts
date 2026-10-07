import { createFileRoute } from "@tanstack/react-router";

/** Public read-only: 50 most recent direction calls, newest first. */
export const Route = createFileRoute("/api/public/scorecard")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("direction_calls")
          .select("*")
          .order("locked_at", { ascending: false })
          .limit(50);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ calls: data ?? [] });
      },
    },
  },
});
