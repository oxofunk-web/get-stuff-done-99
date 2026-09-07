ALTER TABLE public.trade_log
  ADD COLUMN IF NOT EXISTS settle_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settle_checked_at timestamptz;

ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS gate_secs integer NOT NULL DEFAULT 300;

UPDATE public.bot_settings SET gate_secs = 300 WHERE id = true;