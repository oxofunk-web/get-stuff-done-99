import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  proposal_id: z.string().uuid(),
  agent: z.string().min(1).max(64),
  vote: z.enum(["approve", "reject", "abstain"]),
  note: z.string().max(1000).optional(),
});

/** Council: record one squad vote (a re-vote by the same agent replaces theirs). */
export const Route = createFileRoute("/api/public/council/vote")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authCouncil } = await import("@/lib/bot/council.server");
        const denied = await authCouncil(request);
        if (denied) return denied;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
        const v = parsed.data;
        const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
        const { data: p } = await sb.from("council_proposals").select("status,votes").eq("id", v.proposal_id).maybeSingle();
        if (!p) return Response.json({ error: "proposal not found" }, { status: 404 });
        if (p.status !== "pending" && p.status !== "voting")
          return Response.json({ error: `voting closed (status ${p.status})` }, { status: 409 });
        const votes = (Array.isArray(p.votes) ? p.votes : []) as { agent: string }[];
        const next = [...votes.filter((x) => x.agent !== v.agent), { agent: v.agent, vote: v.vote, note: v.note ?? null, at: new Date().toISOString() }];
        const { error } = await sb
          .from("council_proposals")
          .update({ votes: next as never, status: "voting", updated_at: new Date().toISOString() })
          .eq("id", v.proposal_id);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true, votes: next });
      },
    },
  },
});
