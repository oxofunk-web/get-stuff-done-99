ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS take_profit_cents integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS stop_loss_cents integer NOT NULL DEFAULT 10;

ALTER TABLE public.bot_settings ALTER COLUMN mode SET DEFAULT 'live';

ALTER TABLE public.trade_log
  ADD COLUMN IF NOT EXISTS exit_price double precision,
  ADD COLUMN IF NOT EXISTS exit_reason text,
  ADD COLUMN IF NOT EXISTS exit_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS exit_order_id text,
  ADD COLUMN IF NOT EXISTS exit_contracts integer;