CREATE TABLE public.direction_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair text NOT NULL,
  candle_start bigint NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  lock_sec integer NOT NULL,
  dir text NOT NULL,
  prob double precision NOT NULL,
  open_price double precision NOT NULL,
  lock_price double precision NOT NULL,
  close_price double precision,
  result text,
  graded_at timestamptz,
  UNIQUE (pair, candle_start)
);
GRANT ALL ON public.direction_calls TO service_role;
ALTER TABLE public.direction_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "server only direction_calls" ON public.direction_calls FOR ALL TO service_role USING (true) WITH CHECK (true);