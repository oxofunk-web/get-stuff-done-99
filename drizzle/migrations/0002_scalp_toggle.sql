ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS scalp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS scalp_last_msg text;