import { createFileRoute } from "@tanstack/react-router";

import { authenticateScheduledRequest } from "@/lib/bot/cron-auth.server";

/** Scheduled every minute: rules-based candle-start scalper for BTC and ETH. */
export const Route = createFileRoute("/api/public/scalp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateScheduledRequest(request);
        if (denied) return denied;
        const { runScalper } = await import("@/lib/bot/scalper.server");
        return Response.json(await runScalper());
      },
    },
  },
});
