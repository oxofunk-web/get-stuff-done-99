ALTER TABLE public.signal_log ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'client';
DROP INDEX IF EXISTS public.signal_log_unique_idx;
CREATE UNIQUE INDEX signal_log_unique_idx ON public.signal_log USING btree (candle_id, pair, verdict, seconds_in, source);