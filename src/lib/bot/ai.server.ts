/**
 * Thin wrapper around Lovable AI for the bot's advisory layer.
 *
 * AI never decides a trade here: it summarizes the regime and coaches on the
 * recorded history. Every call is structured JSON so the caller can use it as
 * data, and every failure is returned rather than thrown, so a rate-limited or
 * unavailable model can never block a trading tick.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface AiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export async function askForJson<T>(opts: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  model?: string;
}): Promise<AiResult<T>> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) return { ok: false, error: "AI is not configured on the server." };

  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: opts.model ?? "google/gemini-3.7-flash",
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
        },
      }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI request failed" };
  }

  if (!res.ok) {
    let message = `AI request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string }; message?: string };
      message = body.error?.message ?? body.message ?? message;
    } catch {
      // keep the status-based message
    }
    return { ok: false, error: message, status: res.status };
  }

  try {
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text) return { ok: false, error: "AI returned an empty answer." };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI answer was unreadable" };
  }
}
