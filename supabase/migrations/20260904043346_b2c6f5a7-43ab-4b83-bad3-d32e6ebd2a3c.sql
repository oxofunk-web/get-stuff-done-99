ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS run_lease_id uuid,
  ADD COLUMN IF NOT EXISTS run_lease_until timestamp with time zone;

COMMENT ON COLUMN public.bot_settings.run_lease_id IS 'Opaque owner token for the active scheduled bot run.';
COMMENT ON COLUMN public.bot_settings.run_lease_until IS 'Lease expiry that prevents overlapping scheduled bot runs.';