# Making the bot smarter with real data

Three connected upgrades: start recording what actually happens, use that record to judge signal quality honestly, and only take trades where the price gives us real value.

## 1. Enable Lovable Cloud (storage)

Turn on the built-in backend so the bot has persistent memory across refreshes, devices, and days.

Three tables:

- **market_snapshots** — every few seconds, per pair: spot price, strike, yes bid/ask/mid, spread, volume, seconds into candle. This is the raw tape used to re-tune on real books instead of the synthetic model in `scripts/tune.ts`.
- **signal_log** — every signal the engine produces (fired *and* rejected, with the rejection reason from the existing `SignalTrace`), plus all the inputs: confidence, skew, spot momentum, Kalshi momentum, spread, mid, direction, time in candle.
- **trade_log** — actual orders: entry price, size, fill, mode (paper/live), and the settlement outcome once the candle closes.

Each row is stamped with the candle it belongs to, so signals, snapshots, and outcomes join cleanly.

## 2. Outcome tracking and calibration

- A settlement pass runs after each candle closes: read the final spot vs. strike, mark every logged signal for that candle as win/loss, and write the result back.
- New **Accuracy** panel on the dashboard: signals fired, real win rate, win rate bucketed by confidence band (80-85, 85-90, 90-95, 95+), and win rate by pair and by minute-in-candle.
- Calibration mapping: once there's enough history, the raw confidence score is mapped onto the observed win rate for that bucket. The engine then works with an honest probability instead of the current hand-tuned number. Until enough data exists, it falls back to today's behaviour unchanged.

## 3. EV gate and better math

- **Hard EV gate:** a trade only fires when `calibrated_probability > entry_price + margin`. That kills the "95% read at 92¢" trades that risk a lot to win a little. The margin is a slider in the engine panel.
- **Volatility-normalized momentum:** replace the raw percent move with move-divided-by-recent-volatility, so a 0.1% BTC tick and a 0.1% XRP tick aren't treated as equally meaningful.
- **Distance to strike in sigma:** how far spot sits from the strike, measured in standard deviations of recent movement, plus time remaining. This is the single most predictive input for a 15-minute binary and is currently missing entirely.
- Signal ranking keeps expected-value ordering but now uses the calibrated probability.

## 4. Re-tune on real recorded data

Once a few days of `market_snapshots` exist, `scripts/tune.ts` gets a second mode that replays real recorded books instead of generating synthetic ones, and re-sweeps threshold / skew / spread / EV margin / gate against real outcomes.

## Safety

- All of this ships with LIVE MONEY off. Recording and accuracy tracking run in paper mode first.
- The EV gate is additive — it can only reject trades the current engine would have taken, never add new ones.
- No change to order placement or the Kalshi API path.

## Technical notes

- Tables get RLS with explicit grants; writes go through server functions in `src/lib/bot/telemetry.functions.ts`.
- Snapshot writes are batched (one insert per few seconds, not per tick) to keep the row count sane.
- Calibration and new momentum math live in `src/lib/bot/signals.ts` and a new `src/lib/bot/calibration.ts`, both driven by `tuning.ts` so the tuner can still sweep them.
- Settlement pass runs as a server function triggered on candle rollover from the client, idempotent per candle.
