import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled settlement pass. Grades every closed candle that still has
 * ungraded signal or trade rows, using the last recorded spot from the tape.
 * Idempotent, bounded per run, and independent of any open browser tab.
 *
 * When a cron secret is configured the caller must present it. Without one the
 * endpoint stays open: it takes no input, touches only rows whose outcome is
 * still null, and returns nothing but counts.
 */
export const Route = createFileRoute("/api/public/settle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (process.env["LOVABLE_CRON_SECRET"]) {
          const denied = await authenticateCronRequest(request);
          if (denied) return denied;
        }
        const { settlePending } = await import("@/lib/bot/settle.server");
        const result = await settlePending(12);
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
