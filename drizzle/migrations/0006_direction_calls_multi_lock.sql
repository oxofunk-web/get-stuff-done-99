ALTER TABLE public.direction_calls DROP CONSTRAINT IF EXISTS direction_calls_pair_candle_start_key;
CREATE INDEX IF NOT EXISTS direction_calls_pair_candle_idx ON public.direction_calls (pair, candle_start, locked_at DESC);
ALTER TABLE public.trade_log ADD COLUMN IF NOT EXISTS lock_id uuid;