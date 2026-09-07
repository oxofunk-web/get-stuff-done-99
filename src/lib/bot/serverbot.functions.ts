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

interface SettingsPatch {
  enabled?: boolean;
  first_enabled_at?: string;
  bet_size?: number;
  ev_margin?: number;
  max_trades?: number;
  daily_loss_cap?: number;
  threshold?: number;
  min_yes_mid?: number;
  max_yes_mid?: number;
  min_skew?: number;
  max_spread?: number;
  min_sigma_dist?: number;
  gate_secs?: number;
  gate_preset?: string;
  updated_at: string;
}

export const updateServerBot = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        enabled: z.boolean().optional(),
        betSize: z.number().min(1).max(100).optional(),
        evMargin: z.number().min(0).max(0.5).optional(),
        maxTrades: z.number().int().min(1).max(7).optional(),
        dailyLossCap: z.number().min(1).max(1000).optional(),
        // Signal gates
        threshold: z.number().min(50).max(99).optional(),
        minYesMid: z.number().min(0.01).max(0.5).optional(),
        maxYesMid: z.number().min(0.5).max(0.99).optional(),
        minSkew: z.number().min(0).max(0.2).optional(),
        maxSpread: z.number().min(0.01).max(0.2).optional(),
        minSigmaDist: z.number().min(0).max(2).optional(),
        gateSecs: z.number().int().min(60).max(780).optional(),
        gatePreset: z.enum(["strict", "balanced", "aggressive", "custom"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<ServerBotState> => {
    const db = await admin();
    const cur = await loadSettings(db);
    const patch: SettingsPatch = { updated_at: new Date().toISOString() };
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
    if (data.threshold !== undefined) patch.threshold = data.threshold;
    if (data.minYesMid !== undefined) patch.min_yes_mid = data.minYesMid;
    if (data.maxYesMid !== undefined) patch.max_yes_mid = data.maxYesMid;
    if (data.minSkew !== undefined) patch.min_skew = data.minSkew;
    if (data.maxSpread !== undefined) patch.max_spread = data.maxSpread;
    if (data.minSigmaDist !== undefined) patch.min_sigma_dist = data.minSigmaDist;
    if (data.gateSecs !== undefined) patch.gate_secs = data.gateSecs;
    if (data.gatePreset !== undefined) patch.gate_preset = data.gatePreset;
    // Hand-tuning any single gate means the saved preset no longer describes it.
    const touchedGate =
      data.threshold !== undefined ||
      data.evMargin !== undefined ||
      data.minYesMid !== undefined ||
      data.maxYesMid !== undefined ||
      data.minSkew !== undefined ||
      data.maxSpread !== undefined ||
      data.minSigmaDist !== undefined;
    if (touchedGate && data.gatePreset === undefined) patch.gate_preset = "custom";
    await db.from("bot_settings").update(patch).eq("id", true);
    return getServerBotState(db);
  });
