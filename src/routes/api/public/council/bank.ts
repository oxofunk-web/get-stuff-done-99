import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ proposal_id: z.string().uuid() });

/**
 * Council: the Bank decision. The app computes it (budget, fee-adjusted edge,
 * conflicts, concurrency, $5 stake) — callers cannot force an approval.
 */
export const Route = createFileRoute("/api/public/council/bank")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authCouncil, bankGate } = await import("@/lib/bot/council.server");
        const denied = await authCouncil(request);
        if (denied) return denied;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
        const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
        const { data: p } = await sb.from("council_proposals").select("*").eq("id", parsed.data.proposal_id).maybeSingle();
        if (!p) return Response.json({ error: "proposal not found" }, { status: 404 });
        if (p.status !== "pending" && p.status !== "voting")
          return Response.json({ error: `already decided (status ${p.status})` }, { status: 409 });
        const decision = await bankGate(sb, p);
        await sb
          .from("council_proposals")
          .update({ status: decision.approve ? "bank_approved" : "bank_rejected", bank_decision: decision as never, updated_at: new Date().toISOString() })
          .eq("id", p.id);
        return Response.json({ decision });
      },
    },
  },
});
