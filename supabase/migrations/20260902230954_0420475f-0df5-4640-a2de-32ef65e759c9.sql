CREATE TABLE public.bot_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper','live')),
  bet_size double precision NOT NULL DEFAULT 5,
  ev_margin double precision NOT NULL DEFAULT 0.08,
  max_trades integer NOT NULL DEFAULT 2,
  first_enabled_at timestamptz,
  live_confirmed_at timestamptz,
  last_tick_at timestamptz,
  last_tick_msg text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bot_settings TO service_role;
ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no public access to bot_settings" ON public.bot_settings AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
INSERT INTO public.bot_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.trade_log ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'client';
CREATE INDEX IF NOT EXISTS trade_log_candle_source_idx ON public.trade_log (candle_id, source);