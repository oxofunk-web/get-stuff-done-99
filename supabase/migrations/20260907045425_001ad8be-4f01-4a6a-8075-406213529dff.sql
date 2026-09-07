ALTER TABLE public.signal_log
  ADD COLUMN IF NOT EXISTS raw_score double precision,
  ADD COLUMN IF NOT EXISTS minute_in double precision,
  ADD COLUMN IF NOT EXISTS depth integer,
  ADD COLUMN IF NOT EXISTS mom_z double precision,
  ADD COLUMN IF NOT EXISTS cushion_score double precision;

ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS bootstrap_stake numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS bootstrap_max_daily numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS bootstrap_max_entry numeric NOT NULL DEFAULT 0.55,
  ADD COLUMN IF NOT EXISTS bootstrap_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.ai_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  pair text,
  candle_id bigint,
  label text,
  note text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_notes_kind_ts_idx ON public.ai_notes (kind, ts DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_notes_regime_key_idx
  ON public.ai_notes (kind, pair, candle_id)
  WHERE pair IS NOT NULL AND candle_id IS NOT NULL;

GRANT ALL ON public.ai_notes TO service_role;

ALTER TABLE public.ai_notes ENABLE ROW LEVEL SECURITY;
