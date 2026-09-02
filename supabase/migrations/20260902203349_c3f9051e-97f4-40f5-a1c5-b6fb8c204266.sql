CREATE TABLE public.market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  candle_id BIGINT NOT NULL,
  seconds_in INTEGER NOT NULL,
  pair TEXT NOT NULL,
  ticker TEXT,
  spot DOUBLE PRECISION NOT NULL,
  strike DOUBLE PRECISION,
  yes_bid DOUBLE PRECISION,
  yes_ask DOUBLE PRECISION,
  yes_mid DOUBLE PRECISION,
  spread DOUBLE PRECISION,
  vol DOUBLE PRECISION
);
CREATE INDEX market_snapshots_candle_idx ON public.market_snapshots (candle_id, pair);
CREATE INDEX market_snapshots_ts_idx ON public.market_snapshots (ts DESC);
GRANT ALL ON public.market_snapshots TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.market_snapshots_id_seq TO service_role;
ALTER TABLE public.market_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.signal_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  candle_id BIGINT NOT NULL,
  seconds_in INTEGER NOT NULL,
  pair TEXT NOT NULL,
  verdict TEXT NOT NULL,
  reason TEXT,
  dir TEXT,
  conf DOUBLE PRECISION,
  calibrated DOUBLE PRECISION,
  entry_price DOUBLE PRECISION,
  ev DOUBLE PRECISION,
  yes_mid DOUBLE PRECISION,
  spread DOUBLE PRECISION,
  skew DOUBLE PRECISION,
  spot_mom DOUBLE PRECISION,
  k_mom DOUBLE PRECISION,
  sigma_dist DOUBLE PRECISION,
  spot DOUBLE PRECISION,
  strike DOUBLE PRECISION,
  outcome TEXT,
  settled_spot DOUBLE PRECISION,
  settled_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX signal_log_unique_idx ON public.signal_log (candle_id, pair, verdict, seconds_in);
CREATE INDEX signal_log_outcome_idx ON public.signal_log (verdict, outcome);
CREATE INDEX signal_log_ts_idx ON public.signal_log (ts DESC);
GRANT ALL ON public.signal_log TO service_role;
ALTER TABLE public.signal_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.trade_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  candle_id BIGINT NOT NULL,
  pair TEXT NOT NULL,
  dir TEXT NOT NULL,
  mode TEXT NOT NULL,
  conf DOUBLE PRECISION,
  calibrated DOUBLE PRECISION,
  contracts INTEGER,
  entry_price DOUBLE PRECISION,
  stake DOUBLE PRECISION,
  status TEXT NOT NULL,
  msg TEXT,
  order_id TEXT,
  outcome TEXT,
  pnl DOUBLE PRECISION,
  settled_at TIMESTAMPTZ
);
CREATE INDEX trade_log_candle_idx ON public.trade_log (candle_id);
CREATE INDEX trade_log_ts_idx ON public.trade_log (ts DESC);
GRANT ALL ON public.trade_log TO service_role;
ALTER TABLE public.trade_log ENABLE ROW LEVEL SECURITY;