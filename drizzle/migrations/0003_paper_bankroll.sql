ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS paper_bankroll numeric NOT NULL DEFAULT 100;
ALTER TABLE public.trade_log ADD COLUMN IF NOT EXISTS bankroll_applied_at timestamptz;
-- Existing paper rows predate the bankroll; don't retroactively apply them.
UPDATE public.trade_log SET bankroll_applied_at = now() WHERE mode = 'paper' AND bankroll_applied_at IS NULL;

CREATE OR REPLACE FUNCTION public.apply_paper_bankroll(p_fee_per_contract numeric DEFAULT 0.14)
RETURNS TABLE(applied integer, delta numeric, bankroll numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n integer; d numeric; b numeric;
BEGIN
  WITH done AS (
    UPDATE public.trade_log
    SET bankroll_applied_at = now()
    WHERE mode = 'paper' AND status = 'placed' AND outcome IS NOT NULL AND bankroll_applied_at IS NULL
    RETURNING COALESCE(pnl, 0) - CASE WHEN outcome = 'void' THEN 0 ELSE COALESCE(contracts, 0) * p_fee_per_contract END AS net
  )
  SELECT count(*)::int, COALESCE(sum(net), 0) INTO n, d FROM done;
  UPDATE public.bot_settings SET paper_bankroll = paper_bankroll + d WHERE id = true RETURNING paper_bankroll INTO b;
  RETURN QUERY SELECT n, d, b;
END $$;
REVOKE ALL ON FUNCTION public.apply_paper_bankroll(numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paper_bankroll(numeric) TO service_role;