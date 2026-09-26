ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS auto_trade_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS auto_trade_size numeric NOT NULL DEFAULT 10;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS auto_trade_last_msg text;