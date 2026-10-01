-- Paper-trading toggle for the locked-call auto-trader.
-- Defaults to ON (true) so the bot can never place a real order until someone
-- deliberately flips paper mode off in the dashboard.
alter table public.bot_settings
  add column if not exists auto_trade_paper boolean not null default true;
