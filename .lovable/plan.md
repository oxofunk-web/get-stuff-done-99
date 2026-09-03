# Full reset: clean slate for the bot

Three things, exactly as you asked: clear today's loss-cap stop, wipe all learning history, and resume BTC and ETH.

## 1. Reset the trading day
- Re-anchor today's P&L baseline to the wallet as it stands right now, so the $20 daily loss cap is no longer tripped.
- Clear the DAY STOPPED banner on the dashboard.
- Server runner: since its cap check reads today's settled live trades, clearing the trade history (step 2) also clears its stop.
- BOT STATUS stays where you set it — you flip it on to start trading again.

## 2. Reset all telemetry (fresh learning)
Empty these history tables:
- `trade_log` — every past trade attempt, fill and P&L row
- `signal_log` — every fired/rejected signal and its graded outcome
- `market_snapshots` — the recorded price/order-book tape

Effect: PAIR EDGE shows no samples for any pair, so every pair falls back to the global probability curve and nothing is paused. Accuracy/P&L panels start from zero. This does not touch your real Kalshi account, wallet or open positions — only the bot's own records.

## 3. Resume BTC and ETH
- Remove the manual loss baselines that keep BTC and ETH in cooldown (`MANUAL_RESUME` in `src/lib/bot/ranking.ts` currently carries BTC -13.17 and ETH -13.35).
- With history cleared and baselines gone, all seven pairs are eligible again.

## Not changing
Signal math and the 86% confidence threshold, EV gate, sigma/spread/skew filters, 10:00 gate and 14:00 close, $5 stake, 2/3/4 trade cap, one trade per pair, 3¢ slippage cap, minimum 2 contracts resting, $20 daily loss cap value, order placement code, LIVE MONEY arming.

## Technical notes
- Deletes run as three `DELETE FROM` statements against `trade_log`, `signal_log`, `market_snapshots`.
- `bot_settings` untouched (stays live, $5, 4 trades, $20 cap) — heartbeat text refreshes on the next tick.
- Day reset uses the existing `resetDay()` in `src/hooks/useBot.ts`; no new logic.
- Cooldown/veto in `ranking.ts` will read zero settled trades per pair, so `pairVetoed` returns false everywhere.
