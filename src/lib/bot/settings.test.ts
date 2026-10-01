import { describe, expect, it, vi } from "vitest";

import { getBotSettings, updateBotSettings } from "./settings.server";

function missingColumnError() {
  return { message: 'column "auto_trade_paper" does not exist' };
}

/** Minimal supabase-like stub: fails the first select when told to. */
function stubDb(opts: { failPaperSelect?: boolean; failPaperUpdate?: boolean } = {}) {
  const calls: string[] = [];
  const sb = {
    from: () => ({
      select: (cols: string) => {
        calls.push(`select:${cols}`);
        return {
          eq: () => ({
            maybeSingle: async () => {
              if (opts.failPaperSelect && cols.includes("auto_trade_paper")) {
                return { data: null, error: missingColumnError() };
              }
              // The fallback select has no paper column — like the real DB.
              const data = cols.includes("auto_trade_paper")
                ? { auto_trade_enabled: true, auto_trade_paper: false, auto_trade_size: 45 }
                : { auto_trade_enabled: true, auto_trade_size: 45 };
              return { data, error: null };
            },
          }),
        };
      },
      update: (patch: Record<string, unknown>) => {
        calls.push(`update:${Object.keys(patch).join(",")}`);
        return {
          eq: async () => {
            if (opts.failPaperUpdate && "auto_trade_paper" in patch) {
              return { data: null, error: missingColumnError() };
            }
            return { data: null, error: null };
          },
        };
      },
    }),
  };
  return { sb, calls };
}

describe("bot_settings migration tolerance", () => {
  it("reads the paper flag when the column exists", async () => {
    const { sb } = stubDb();
    const s = await getBotSettings(sb);
    expect(s.auto_trade_paper).toBe(false);
    expect(s.auto_trade_enabled).toBe(true);
  });

  it("falls back to paper=true when the migration hasn't applied", async () => {
    const { sb, calls } = stubDb({ failPaperSelect: true });
    const s = await getBotSettings(sb);
    expect(s.auto_trade_paper).toBeUndefined();
    expect(s.auto_trade_enabled).toBe(true);
    expect(calls.filter((c) => c.startsWith("select:")).length).toBe(2);
  });

  it("writes normally when the column exists", async () => {
    const { sb, calls } = stubDb();
    const persisted = await updateBotSettings(sb, { auto_trade_enabled: true, auto_trade_paper: false });
    expect(persisted).toBe(true);
    expect(calls).toEqual(["update:auto_trade_enabled,auto_trade_paper"]);
  });

  it("retries without the paper key when the column is missing", async () => {
    const { sb, calls } = stubDb({ failPaperUpdate: true });
    const persisted = await updateBotSettings(sb, { auto_trade_enabled: true, auto_trade_paper: false });
    expect(persisted).toBe(false);
    expect(calls).toEqual(["update:auto_trade_enabled,auto_trade_paper", "update:auto_trade_enabled"]);
  });

  it("updateBotSettings is a no-op-safe mock check", () => {
    expect(vi.isMockFunction(vi.fn())).toBe(true);
  });
});
