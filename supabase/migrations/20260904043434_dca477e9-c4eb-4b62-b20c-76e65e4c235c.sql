CREATE OR REPLACE FUNCTION public.acquire_bot_run_lease(
  p_lease_id uuid,
  p_lease_seconds integer DEFAULT 55
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acquired boolean;
BEGIN
  UPDATE public.bot_settings
  SET run_lease_id = p_lease_id,
      run_lease_until = now() + make_interval(secs => greatest(5, least(p_lease_seconds, 120)))
  WHERE id = true
    AND (run_lease_until IS NULL OR run_lease_until < now() OR run_lease_id = p_lease_id)
  RETURNING true INTO acquired;

  RETURN coalesce(acquired, false);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_bot_run_lease(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_bot_run_lease(uuid, integer) TO service_role;