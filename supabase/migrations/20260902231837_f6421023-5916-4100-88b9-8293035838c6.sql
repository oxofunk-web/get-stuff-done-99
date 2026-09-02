CREATE TABLE public.cron_token (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.cron_token TO service_role;
ALTER TABLE public.cron_token ENABLE ROW LEVEL SECURITY;
INSERT INTO public.cron_token (token) VALUES (encode(gen_random_bytes(24), 'hex'));