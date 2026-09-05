ALTER TABLE public.trade_log
  ADD COLUMN IF NOT EXISTS ticker text,
  ADD COLUMN IF NOT EXISTS strike double precision;