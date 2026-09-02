import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Auth for scheduler-called routes. Accepts either the platform-managed
 * LOVABLE_CRON_SECRET bearer or the DB-held token from public.cron_token
 * (service-role only), which is what pg_cron jobs send.
 */
export async function authenticateScheduledRequest(
  request: Request,
): Promise<Response | null> {
  const match = /^Bearer ([^\s,]+)$/.exec(
    request.headers.get("authorization") ?? "",
  );
  const token = match?.[1];
  if (token) {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data } = await supabaseAdmin
      .from("cron_token")
      .select("token")
      .eq("id", true)
      .maybeSingle();
    if (data?.token) {
      const { createHash, timingSafeEqual } = await import("node:crypto");
      const digest = (v: string) =>
        createHash("sha256").update(v, "utf8").digest();
      if (timingSafeEqual(digest(token), digest(data.token))) return null;
    }
  }
  if (process.env["LOVABLE_CRON_SECRET"]) {
    return authenticateCronRequest(request);
  }
  return new Response("Unauthorized", { status: 401 });
}
