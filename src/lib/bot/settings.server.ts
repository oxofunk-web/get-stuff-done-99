/**
 * bot_settings access with migration tolerance.
 *
 * The `auto_trade_paper` column is added by a migration that may not have been
 * applied to every database (Lovable doesn't always apply migrations on sync).
 * Instead of breaking when it's missing, reads fall back to the rest of the
 * columns with paper defaulting to true (safe: no real orders), and writes
 * retry without the paper key. Flipping to LIVE truly requires the column;
 * paper mode works regardless.
 */
export interface BotSettings {
  auto_trade_enabled?: boolean;
  auto_trade_paper?: boolean;
  auto_trade_size?: number;
  daily_loss_cap?: number;
  auto_trade_last_msg?: string | null;
  paper_bankroll?: number;
  paper_bank_reset_at?: string | null;
}

const ALL_COLS =
  "auto_trade_enabled,auto_trade_paper,auto_trade_size,daily_loss_cap,auto_trade_last_msg,paper_bankroll";
const FALLBACK_COLS =
  "auto_trade_enabled,auto_trade_size,daily_loss_cap,auto_trade_last_msg";

function missingPaperColumn(error: unknown): boolean {
  const msg = (error as { message?: string } | null)?.message ?? "";
  return /auto_trade_paper/.test(msg);
}

/** eslint-disable-next-line @typescript-eslint/no-explicit-any */
export async function getBotSettings(sb: any): Promise<BotSettings> {
  let res = await sb.from("bot_settings").select(ALL_COLS).eq("id", true).maybeSingle();
  if (res.error && missingPaperColumn(res.error)) {
    res = await sb.from("bot_settings").select(FALLBACK_COLS).eq("id", true).maybeSingle();
  }
  return (res.data ?? {}) as BotSettings;
}

/**
 * Updates bot_settings, dropping the paper key and retrying if the column
 * doesn't exist yet. Returns true when the paper key was persisted.
 */
/** eslint-disable-next-line @typescript-eslint/no-explicit-any */
export async function updateBotSettings(sb: any, patch: Record<string, unknown>): Promise<boolean> {
  let rest = { ...patch };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let res: any = await sb.from("bot_settings").update(rest).eq("id", true);
  if (res.error && missingPaperColumn(res.error) && "auto_trade_paper" in rest) {
    delete rest["auto_trade_paper"];
    res = await sb.from("bot_settings").update(rest).eq("id", true);
    return false;
  }
  return !res.error;
}
