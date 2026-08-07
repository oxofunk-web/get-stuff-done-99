import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const reviewInput = z.object({
  pair: z.string().max(8),
  dir: z.enum(["YES", "NO"]),
  conf: z.number(),
  yesMid: z.number(),
  spread: z.number(),
  spotMom: z.number(),
  kMom: z.number(),
  lagDetected: z.boolean(),
  spot: z.number(),
  strike: z.number().nullable(),
  secondsLeft: z.number(),
  betSize: z.number(),
  reason: z.string().max(1200),
});

export interface AiVerdict {
  verdict: "take" | "skip";
  confidence: number;
  rationale: string;
  risk: string;
}

/**
 * Second opinion on a live signal from Lovable AI. Streams so long reasoning
 * runs never hit a request timeout; only the final JSON is returned.
 */
export const reviewSignal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => reviewInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; verdict: AiVerdict } | { ok: false; error: string }> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { ok: false as const, error: "AI is not configured on the server." };

    const prompt = [
      `Kalshi 15-minute crypto binary market. Judge whether to take this trade.`,
      `Pair: ${data.pair}  Proposed side: ${data.dir}  Engine confidence: ${data.conf.toFixed(1)}%`,
      `Strike: ${data.strike ?? "n/a"}  BRTI spot: ${data.spot}`,
      `YES mid: ${(data.yesMid * 100).toFixed(0)}c  Spread: ${(data.spread * 100).toFixed(1)}c`,
      `BRTI momentum: ${(data.spotMom * 100).toFixed(3)}%  Kalshi mid velocity: ${(data.kMom * 100).toFixed(2)}c`,
      `Lag divergence detected: ${data.lagDetected}`,
      `Seconds until candle close: ${Math.round(data.secondsLeft)}  Stake: $${data.betSize}`,
      `Engine reasoning: ${data.reason}`,
      ``,
      `Rules: skip when the spread eats the edge, when spot momentum contradicts the side, when the strike is far from spot with little time left, or when the book already prices the move. Keep rationale under 240 characters and risk under 120 characters. Respond as json.`,
    ].join("\n");

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": key,
          "X-Lovable-AIG-SDK": "fetch",
        },
        body: JSON.stringify({
          model: "openai/gpt-5.6-sol",
          input: prompt,
          stream: true,
          store: false,
          reasoning: { effort: "low", summary: "auto" },
          text: {
            format: {
              type: "json_schema",
              name: "trade_review",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  verdict: { type: "string", enum: ["take", "skip"] },
                  confidence: { type: "number" },
                  rationale: { type: "string" },
                  risk: { type: "string" },
                },
                required: ["verdict", "confidence", "rationale", "risk"],
              },
            },
          },
        }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        if (res.status === 429) return { ok: false as const, error: "AI rate limit — try again shortly." };
        if (res.status === 402) return { ok: false as const, error: "AI credits exhausted." };
        return { ok: false as const, error: `AI error ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}` };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let text = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload) as {
              type?: string;
              delta?: string;
              response?: { output_text?: string };
            };
            if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
              text += evt.delta;
            } else if (evt.type === "response.completed" && evt.response?.output_text) {
              if (!text) text = evt.response.output_text;
            }
          } catch {
            // ignore keep-alives
          }
        }
      }

      if (!text.trim()) return { ok: false as const, error: "AI returned no answer." };
      const parsed = JSON.parse(text) as AiVerdict;
      return {
        ok: true as const,
        verdict: {
          verdict: parsed.verdict === "skip" ? "skip" : "take",
          confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
          rationale: String(parsed.rationale ?? "").slice(0, 400),
          risk: String(parsed.risk ?? "").slice(0, 200),
        },
      };
    } catch (e) {
      console.error("AI review failed", e);
      return { ok: false as const, error: e instanceof Error ? e.message : "AI review failed" };
    }
  });
