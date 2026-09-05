UPDATE public.bot_settings
SET enabled = false,
    mode = 'paper',
    gate_preset = 'strict',
    threshold = 78,
    ev_margin = 0.08,
    min_yes_mid = 0.12,
    max_yes_mid = 0.90,
    min_skew = 0.04,
    max_spread = 0.05,
    min_sigma_dist = 0.55,
    bet_size = 5,
    max_trades = 1,
    daily_loss_cap = 20,
    last_tick_msg = 'Signals rebuilt on the de-saturated score scale. Shadow validation in progress; live trading off.',
    updated_at = now();

DELETE FROM public.signal_log;