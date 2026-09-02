import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  getServerBotState,
  loadSettings,
  warmupMsLeft,
  type ServerBotState,
} from "./server-engine.server";

/**
 * Dashboard controls for the server-side bot: read its state, flip it on/off,
 * tune bet size and EV margin, and confirm live trading after the warmup.
 * The settings row is service-role only, so every read/write goes through
 * here — the browser never touches the table directly.
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
        mode: z.enum(["paper", "live"]).optional(),
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
      mode?: "paper" | "live";
      updated_at: string;
    } = { updated_at: new Date().toISOString() };
    if (data.enabled !== undefined) {
      patch.enabled = data.enabled;
      // First-ever enable starts the 24h paper warmup clock.
      if (data.enabled && !cur.first_enabled_at) {
        patch.first_enabled_at = new Date().toISOString();
      }
    }
    if (data.betSize !== undefined) patch.bet_size = data.betSize;
    if (data.evMargin !== undefined) patch.ev_margin = data.evMargin;
    // Requesting live without a prior confirmation still runs paper server-side
    // until confirmServerLive stamps live_confirmed_at.
    if (data.mode !== undefined) patch.mode = data.mode;
    await db.from("bot_settings").update(patch).eq("id", true);
    return getServerBotState(db);
  });

/**
 * Second, explicit confirmation that the server may place real-money orders
 * with the app closed. Refuses until the 24h paper warmup has elapsed.
 */
export const confirmServerLive = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean; state?: ServerBotState; error?: string; hoursLeft?: number }> => {
    const db = await admin();
    const cur = await loadSettings(db);
    const left = warmupMsLeft(cur);
    if (left > 0) {
      return {
        ok: false,
        error: "warmup",
        hoursLeft: Math.round((left / 3600000) * 10) / 10,
      };
    }
    await db
      .from("bot_settings")
      .update({
        live_confirmed_at: new Date().toISOString(),
        mode: "live",
        enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    return { ok: true, state: await getServerBotState(db) };
  },
);
