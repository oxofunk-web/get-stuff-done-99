REVOKE EXECUTE ON FUNCTION public.bot_risk_snapshot(timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bot_risk_snapshot(timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bot_risk_snapshot(timestamptz) TO service_role;