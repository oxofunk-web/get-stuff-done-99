import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  proposing_agent: z.string().min(1).max(64),
  market: z.string().regex(/^KX(BTC|ETH|SOL|XRP|DOGE)15M-[A-Z0-9-]+$/, "crypto 15-min Kalshi ticker only"),
  side: z.enum(["yes", "no"]),
  entry_target: z.number().int().min(1).max(99),
  size: z.number().positive().max(5).default(5),
  thesis: z.string().min(1).max(2000),
  confidence: z.number().gt(0).lt(1),
  expires_at: z.string().datetime(),
});

/** Council: submit a proposal. Bearer council token required. */
export const Route = createFileRoute("/api/public/council/propose")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authCouncil } = await import("@/lib/bot/council.server");
        const denied = await authCouncil(request);
        if (denied) return denied;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.from("council_proposals").insert(parsed.data).select("id,status").single();
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ proposal: data });
      },
    },
  },
});
