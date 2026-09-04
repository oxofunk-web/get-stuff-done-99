import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getServerBotState, loadSettings, type ServerBotState } from "./server-engine.server";

/**
 * Dashboard controls for the server-side bot: read its state, arm/disarm live
 * trading, and tune bet size, EV margin, candle cap, loss cap and the exit
 * thresholds. Trading is live-only — flipping the switch on arms real money
 * immediately. The settings row is service-role only, so every read/write goes
 * through here; the browser never touches the table directly.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type { ServerBotState };

export const getServerBot = createServerFn({ method: "GET" }).handler(async (): Promise<ServerBotState> => {
  const db = await admin();
  return getServerBotState(db);
});

export const updateServerBot = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        enabled: z.boolean().optional(),
        betSize: z.number().min(1).max(100).optional(),
        evMargin: z.number().min(0).max(0.5).optional(),
        maxTrades: z.number().int().min(1).max(7).optional(),
        dailyLossCap: z.number().min(1).max(1000).optional(),
        takeProfitCents: z.number().int().min(2).max(50).optional(),
        stopLossCents: z.number().int().min(2).max(50).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<ServerBotState> => {
    const db = await admin();
    const cur = await loadSettings(db);
    const patch: {
      enabled?: boolean;
      first_enabled_at?: string;
      bet_size?: number;
      ev_margin?: number;
      max_trades?: number;
      daily_loss_cap?: number;
      take_profit_cents?: number;
      stop_loss_cents?: number;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };
    if (data.enabled !== undefined) {
      patch.enabled = data.enabled;
      if (data.enabled && !cur.first_enabled_at) {
        patch.first_enabled_at = new Date().toISOString();
      }
    }
    if (data.betSize !== undefined) patch.bet_size = data.betSize;
    if (data.evMargin !== undefined) patch.ev_margin = data.evMargin;
    if (data.maxTrades !== undefined) patch.max_trades = data.maxTrades;
    if (data.dailyLossCap !== undefined) patch.daily_loss_cap = data.dailyLossCap;
    if (data.takeProfitCents !== undefined) patch.take_profit_cents = data.takeProfitCents;
    if (data.stopLossCents !== undefined) patch.stop_loss_cents = data.stopLossCents;
    await db.from("bot_settings").update(patch).eq("id", true);
    return getServerBotState(db);
  });
