import { createFileRoute } from "@tanstack/react-router";

import { authenticateScheduledRequest } from "@/lib/bot/cron-auth.server";

/** Scheduled every minute: locked-call auto-trades. */
export const Route = createFileRoute("/api/public/autotrade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateScheduledRequest(request);
        if (denied) return denied;
        const { runAutoTrade } = await import("@/lib/bot/autotrade.server");
        return Response.json({ auto: await runAutoTrade() });
      },
    },
  },
});
