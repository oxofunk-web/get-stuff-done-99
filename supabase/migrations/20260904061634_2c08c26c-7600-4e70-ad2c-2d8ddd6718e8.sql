ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS threshold numeric NOT NULL DEFAULT 78,
  ADD COLUMN IF NOT EXISTS min_yes_mid numeric NOT NULL DEFAULT 0.08,
  ADD COLUMN IF NOT EXISTS max_yes_mid numeric NOT NULL DEFAULT 0.94,
  ADD COLUMN IF NOT EXISTS min_skew numeric NOT NULL DEFAULT 0.02,
  ADD COLUMN IF NOT EXISTS max_spread numeric NOT NULL DEFAULT 0.07,
  ADD COLUMN IF NOT EXISTS min_sigma_dist numeric NOT NULL DEFAULT 0.35,
  ADD COLUMN IF NOT EXISTS gate_preset text NOT NULL DEFAULT 'balanced';

UPDATE public.bot_settings
SET threshold = 78, ev_margin = 0.04, min_yes_mid = 0.08, max_yes_mid = 0.94,
    min_skew = 0.02, max_spread = 0.07, min_sigma_dist = 0.35, gate_preset = 'balanced',
    updated_at = now()
WHERE id = true;

GRANT ALL ON public.bot_settings TO service_role;