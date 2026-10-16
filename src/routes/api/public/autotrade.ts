import { createFileRoute } from "@tanstack/react-router";

import { authenticateScheduledRequest } from "@/lib/bot/cron-auth.server";

/** Scheduled every minute: form locks and simulate paper trades on real markets. */
export const Route = createFileRoute("/api/public/autotrade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateScheduledRequest(request);
        if (denied) return denied;
        const { runAutoTrade } = await import("@/lib/bot/autotrade.server");
        const { gradeDirectionCalls } = await import("@/lib/bot/feed.server");
        const { settlePending } = await import("@/lib/bot/settle.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const [auto, grading, settlement] = await Promise.all([
          runAutoTrade(),
          gradeDirectionCalls(supabaseAdmin).catch((e) => ({ error: String(e) })),
          settlePending().catch((e) => ({ error: String(e) })),
        ]);
        return Response.json({ auto, grading, settlement });
      },
    },
  },
});
