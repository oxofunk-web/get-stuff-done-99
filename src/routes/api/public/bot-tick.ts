import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled server-bot tick (every minute via pg_cron). Samples the feeds,
 * records the tape, re-scores the signal engine, and — when the server bot is
 * enabled — places this candle's orders. Idempotent per candle: the per-candle
 * trade cap is enforced from `trade_log`, and signal rows upsert on their
 * natural key, so a duplicate tick never double-orders.
 *
 * Same auth posture as /api/public/settle: when a cron secret is configured
 * the caller must present it; without one the endpoint stays open but takes no
 * input and trades only under the saved, dashboard-controlled settings.
 */
export const Route = createFileRoute("/api/public/bot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (process.env["LOVABLE_CRON_SECRET"]) {
          const denied = await authenticateCronRequest(request);
          if (denied) return denied;
        }
        const { runServerBotTick } = await import("@/lib/bot/server-engine.server");
        const result = await runServerBotTick();
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
