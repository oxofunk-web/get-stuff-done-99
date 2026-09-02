# Next: make the recorded tape actually teach the bot

The recording layer works — 1,468 market snapshots and 1,456 signal rows over the last ~1.5 hours, plus 31 trade rows. But **zero rows have an outcome yet**, so calibration is still running on raw confidence and the accuracy panel has nothing to show. That is the one thing blocking every other improvement.

## 1. Fix settlement (the blocker)

Today grading only happens if the browser tab is open at the exact second a 15-minute candle rolls over. Miss the moment — phone locked, tab backgrounded, page reloaded — and that candle is never graded. Six candles were logged; none were settled.

Move settlement off the browser:

- A public endpoint (`/api/public/settle`) that grades every candle older than the current one that still has ungraded rows, using the last recorded spot for that candle from `market_snapshots` instead of a value passed from the client.
- Run it on a schedule (every few minutes) so grading happens whether or not anyone is watching, and keep it idempotent so re-runs are harmless.
- Keep the client-side rollover call as a fast path; the scheduled pass is the safety net.

## 2. Grade rejected signals too, not just fired ones

Only 26 of 1,456 logged signals have a direction, because rejected signals record no direction and therefore can never be scored. That throws away almost all the data.

For every logged signal, record the direction the engine *would* have taken and grade it as a counterfactual. That turns ~1,400 rows/1.5h into training data instead of 26, so the confidence bands reach the 20-sample calibration floor in hours instead of weeks — and it answers the question that matters: are the filters rejecting trades that would have won?

## 3. Rejection-reason report

A small panel (or script output) that ranks rejection reasons by how often they fire and what the counterfactual win rate of those rejected signals was. A filter that rejects 400 signals which would have won 88% of the time is a filter to loosen; one that rejects coin flips is doing its job.

## 4. Re-tune once there is a real day of tape

With settlement working, `bun scripts/tune.ts --hours 24` sweeps threshold / skew / gate / spread / EV margin against real recorded books *and* real outcomes. Apply the winning combination to the defaults in `tuning.ts` only if it beats the current setting on both ROI and trade count.

## Safety

- LIVE MONEY stays off through all of this. No change to order placement or the Kalshi API path.
- Settlement and counterfactual grading are read-and-annotate only; they never place a trade.

## Technical notes

- New server route `src/routes/api/public/settle.ts` with a shared-secret header check, calling a refactored `settleCandle` that resolves finals from `market_snapshots` (latest `seconds_in` per pair per candle).
- `signal_log` gets the would-be direction written on rejected rows in `useBot.ts`'s trace recorder; `computeSignals` already computes direction before most rejection points — the rejection paths that run before it get a momentum-sign fallback.
- Accuracy aggregation splits fired vs. counterfactual so calibration can be pointed at either set (default: fired + counterfactual, since the engine needs an honest probability across the whole confidence range).
