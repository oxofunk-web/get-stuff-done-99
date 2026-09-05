UPDATE public.trade_log
SET strategy_version = 'legacy'
WHERE strategy_version IS NULL OR strategy_version <> 'stable-v2';

UPDATE public.bot_settings
SET enabled = false,
    bet_size = 5,
    max_trades = 1,
    threshold = 86,
    ev_margin = 0.08,
    min_yes_mid = 0.12,
    max_yes_mid = 0.90,
    min_skew = 0.04,
    max_spread = 0.05,
    min_sigma_dist = 0.55,
    gate_preset = 'strict',
    run_lease_id = NULL,
    run_lease_until = NULL,
    updated_at = now()
WHERE id = true;