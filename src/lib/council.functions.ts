import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getCouncil = createServerFn({ method: "GET" }).handler(async () => {
  const { councilState } = await import("./bot/council.server");
  return councilState();
});

/** HALT COUNCIL: immediately stops every council bank approval and execution. */
export const setCouncilHalt = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ halted: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("council_settings")
      .update({ halted: data.halted, halted_at: data.halted ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", true);
    const { councilState } = await import("./bot/council.server");
    return councilState();
  });
