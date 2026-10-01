import { createFileRoute } from "@tanstack/react-router";

import { authenticateScheduledRequest } from "@/lib/bot/cron-auth.server";

/** Scheduled every minute: locked-call trades + the candle-start scalper. */
export const Route = createFileRoute("/api/public/autotrade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateScheduledRequest(request);
        if (denied) return denied;
        const { runAutoTrade } = await import("@/lib/bot/autotrade.server");
        const { runScalper } = await import("@/lib/bot/scalper.server");
        const [auto, scalp] = await Promise.all([runAutoTrade(), runScalper()]);
        return Response.json({ auto, scalp });
      },
    },
  },
});
