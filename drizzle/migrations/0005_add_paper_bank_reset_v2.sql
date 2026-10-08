ALTER TABLE public.bot_settings ADD COLUMN IF NOT EXISTS paper_bank_reset_at timestamptz;

CREATE OR REPLACE FUNCTION public.apply_paper_bankroll_v2(p_fee_per_contract numeric)
RETURNS TABLE(applied integer, delta numeric, bankroll numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta numeric := 0;
  v_applied integer := 0;
  v_bank numeric;
  v_reset timestamptz;
BEGIN
  SELECT paper_bank_reset_at INTO v_reset FROM public.bot_settings WHERE id = true;

  WITH due AS (
    SELECT t.id, COALESCE(t.pnl, 0) - COALESCE(t.exit_contracts, t.contracts, 0) * p_fee_per_contract AS d
    FROM public.trade_log t
    WHERE t.mode = 'paper'
      AND t.bankroll_applied_at IS NULL
      AND (t.outcome IS NOT NULL OR t.exit_at IS NOT NULL)
      AND (v_reset IS NULL OR t.ts >= v_reset)
  ), upd AS (
    UPDATE public.trade_log t SET bankroll_applied_at = now()
    FROM due WHERE t.id = due.id
    RETURNING due.d
  )
  SELECT COALESCE(SUM(d), 0), COUNT(*) INTO v_delta, v_applied FROM upd;

  UPDATE public.bot_settings
  SET paper_bankroll = paper_bankroll + v_delta, updated_at = now()
  WHERE id = true
  RETURNING paper_bankroll INTO v_bank;

  RETURN QUERY SELECT v_applied, v_delta, v_bank;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_paper_bankroll_v2(numeric) TO service_role;