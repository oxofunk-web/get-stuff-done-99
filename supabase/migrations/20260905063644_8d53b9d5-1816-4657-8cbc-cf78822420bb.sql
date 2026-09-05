ALTER TABLE public.market_snapshots
  ADD COLUMN IF NOT EXISTS strike_type text,
  ADD COLUMN IF NOT EXISTS quote_observed_at timestamptz;

ALTER TABLE public.signal_log
  ADD COLUMN IF NOT EXISTS strike_type text,
  ADD COLUMN IF NOT EXISTS strategy_version text NOT NULL DEFAULT 'legacy';

ALTER TABLE public.trade_log
  ADD COLUMN IF NOT EXISTS strike_type text,
  ADD COLUMN IF NOT EXISTS strategy_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS quote_age_ms integer,
  ADD COLUMN IF NOT EXISTS requested_contracts integer,
  ADD COLUMN IF NOT EXISTS visible_depth integer;

ALTER TABLE public.market_snapshots
  ADD CONSTRAINT market_snapshots_strike_type_check
  CHECK (strike_type IS NULL OR strike_type IN ('floor', 'cap'));
ALTER TABLE public.signal_log
  ADD CONSTRAINT signal_log_strike_type_check
  CHECK (strike_type IS NULL OR strike_type IN ('floor', 'cap'));
ALTER TABLE public.trade_log
  ADD CONSTRAINT trade_log_strike_type_check
  CHECK (strike_type IS NULL OR strike_type IN ('floor', 'cap'));

DELETE FROM public.signal_log;

UPDATE public.bot_settings
SET enabled = false,
    mode = 'live',
    bet_size = 5,
    max_trades = 1,
    threshold = 85,
    ev_margin = 0.08,
    min_yes_mid = 0.12,
    max_yes_mid = 0.88,
    min_skew = 0.04,
    max_spread = 0.04,
    min_sigma_dist = 0.60,
    gate_preset = 'strict',
    run_lease_id = NULL,
    run_lease_until = NULL,
    last_tick_msg = 'stability repair applied · shadow validation · live trading OFF',
    updated_at = now()
WHERE id = true;