import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled settlement pass. Grades every closed candle that still has
 * ungraded signal or trade rows, using the last recorded spot from the tape.
 * Idempotent, bounded per run, and independent of any open browser tab.
 */
export const Route = createFileRoute("/api/public/settle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { settlePending } = await import("@/lib/bot/settle.server");
        const result = await settlePending(12);
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
