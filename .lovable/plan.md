# Retry market pulls, show real errors, and clean up the signal log

## What's going on (verified against live data)
- **Fired signals have been good**: since the reset, server-fired signals that settled went 339 wins / 34 losses (~91%). The signal engine itself is not the problem.
- **Live orders are what fail**: in the last 24h, order attempts failed on "book too thin — nothing resting at the live price" (24x), quotes moving past the chase cap (many), and resting size vanishing before the IOC landed (7x). Good signal, untradeable book at that second.
- **The log is flooded with junk**: ~11,400 "outside the trade window" rejects in 6 hours. Bad/unusable samples are being written to the same log as real signals, which makes the dashboard and calibration noisy.

## Changes

### 1. Retry failed market pulls, show real errors (approved plan)
- `src/lib/kalshi.functions.ts`: retry each pair's fetch up to 2 more times (≈400ms, ≈1s pauses); return per-pair status with a short reason on failure; `ok` true if any pair loaded.
- `src/hooks/useBot.ts`: on a failed pull, quick-retry after ~2s (up to 2x) instead of waiting the full 8s; keep last good orderbooks on screen; track `lastOkAt` + the real error; only mark the feed down after 3 consecutive failures.
- `src/components/bot/MarketsPanel.tsx`: amber "LIVE DATA STALE — retrying (Xs)" chip while showing older data; red chip with the actual error and a "Retry now" button after retries are exhausted; a failed pair's row shows "unavailable — retrying" instead of vanishing.

### 2. Only good signals reach the live log
- `src/lib/bot/server-engine.server.ts`: stop writing `rejected` rows for "outside the trade window" and "not enough live data yet" — these are noise, not decisions. Still record:
  - every **fired** signal (kept permanently in the log),
  - every **skipped** row (a good signal whose order couldn't be sent — the "why no order" trail),
  - in-window rejects that cleared most gates (confidence, value, momentum) so the dashboard's "blocking right now" list still works.
- Result: the live log becomes a list of real, tradeable opportunities — good ones stay, junk never gets written.

### 3. Cut down "good signal, no fill" failures
- Before sending, require minimum resting depth at the touch (already `MIN_RESTING_DEPTH`) **plus** re-check depth on the fresh pre-order quote, so "book too thin" failures are skipped before an attempt is logged.
- No change to gates, thresholds, or sizing. Live trading stays OFF.

## Verification
- `bunx tsgo --noEmit` + existing bot test suite.
- Preview: confirm the stale/error chip appears when the market request fails and recovers on its own.
- After a trade window, confirm `signal_log` contains only in-window decisions and fired/skipped rows.
