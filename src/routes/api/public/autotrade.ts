import { createFileRoute } from "@tanstack/react-router";

import { authenticateScheduledRequest } from "@/lib/bot/cron-auth.server";

/** Scheduled every minute: locked-call auto-trades. */
export const Route = createFileRoute("/api/public/autotrade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateScheduledRequest(request);
        if (denied) return denied;
        const { runAutoTrade, runTakeProfit } = await import("@/lib/bot/autotrade.server");
        const { gradeDirectionCalls } = await import("@/lib/bot/feed.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const [auto, exits, grading] = await Promise.all([
          runAutoTrade(),
          runTakeProfit(),
          gradeDirectionCalls(supabaseAdmin).catch((e) => ({ error: String(e) })),
        ]);
        // Settle pass for paper bankroll (paper rows settled by exits or grading).
        const { applyPaperBankroll } = await import("@/lib/bot/settle.server");
        const bank = await applyPaperBankroll(supabaseAdmin).catch((e) => ({ error: String(e) }));
        return Response.json({ auto, exits, grading, bank });
      },
    },
  },
});
