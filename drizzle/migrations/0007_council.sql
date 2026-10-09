CREATE TABLE public.council_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  proposing_agent text NOT NULL,
  market text NOT NULL,
  side text NOT NULL CHECK (side IN ('yes','no')),
  entry_target integer NOT NULL CHECK (entry_target BETWEEN 1 AND 99),
  size numeric NOT NULL,
  thesis text NOT NULL,
  confidence numeric NOT NULL CHECK (confidence > 0 AND confidence < 1),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','voting','bank_approved','bank_rejected','executed','graded')),
  votes jsonb NOT NULL DEFAULT '[]'::jsonb,
  bank_decision jsonb,
  order_id text,
  order_error text,
  contracts integer,
  fill_price numeric,
  stake numeric,
  filled_at timestamptz,
  trade_id uuid,
  candle_id bigint,
  outcome text,
  pnl numeric,
  graded_at timestamptz
);
GRANT ALL ON public.council_proposals TO service_role;
ALTER TABLE public.council_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "council proposals server only" ON public.council_proposals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX council_proposals_created_idx ON public.council_proposals (created_at DESC);

CREATE TABLE public.council_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  halted boolean NOT NULL DEFAULT false,
  halted_at timestamptz,
  api_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.council_settings TO service_role;
ALTER TABLE public.council_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "council settings server only" ON public.council_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
INSERT INTO public.council_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.trade_log ADD COLUMN IF NOT EXISTS council boolean NOT NULL DEFAULT false;
ALTER TABLE public.trade_log ADD COLUMN IF NOT EXISTS agent text;
ALTER TABLE public.trade_log ADD COLUMN IF NOT EXISTS proposal_id uuid;