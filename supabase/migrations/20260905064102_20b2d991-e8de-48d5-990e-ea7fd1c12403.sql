CREATE OR REPLACE FUNCTION public.bot_risk_snapshot(p_day_start timestamptz)
RETURNS TABLE(settled_pnl numeric, open_risk numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(COALESCE(t.pnl, 0)), 0)::numeric AS settled_pnl,
    COALESCE(SUM(CASE WHEN t.status = 'placed' AND t.outcome IS NULL THEN GREATEST(COALESCE(t.stake, 0), 0) ELSE 0 END), 0)::numeric AS open_risk
  FROM public.trade_log t
  WHERE t.source = 'server' AND t.ts >= p_day_start;
$$;

REVOKE ALL ON FUNCTION public.bot_risk_snapshot(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_risk_snapshot(timestamptz) TO service_role;