import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ proposal_id: z.string().uuid() });

/** Council: execute a bank-approved proposal as a REAL Kalshi order (Bank re-checked first). */
export const Route = createFileRoute("/api/public/council/execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authCouncil, executeProposal } = await import("@/lib/bot/council.server");
        const denied = await authCouncil(request);
        if (denied) return denied;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
        const r = await executeProposal(parsed.data.proposal_id);
        return Response.json(r, { status: r.status });
      },
    },
  },
});
