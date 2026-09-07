# Make the terminal wake up by itself

## What is happening

When you leave the app on your phone, the phone freezes everything the page is doing: the live price stream is cut and every repeating check (prices, market books, wallet, bot state) is paused. When you come back, nothing tells the app that time has passed, so:

- the price stream is dead but the app does not know it, and only notices minutes later
- the market books, wallet and bot status still show the numbers from before you left
- the only way to get a fresh screen is to reload the terminal by hand

Nothing is broken in the trading logic — the server bot keeps running on its own. This is purely the on-screen monitor going stale.

## The fix

1. **Notice the return.** When the app becomes visible again (or the phone regains network), treat it as a wake-up.
2. **Rebuild the price stream immediately** instead of waiting for a timeout: drop the old connection and start again from the best source.
3. **Refresh everything at once on wake-up**: market books, wallet and positions, bot settings and recent trades, and the accuracy figures.
4. **Mark stale data honestly.** If the newest price is older than a few seconds, show the feed as reconnecting rather than showing an old number as if it were live.
5. **Throw away frozen price history.** Ticks recorded before the app slept must not be mixed with fresh ones, so signals are never scored on a gap.
6. **Show a short "reconnecting…" state** in the header for the second or two the refresh takes, so it is obvious it is happening on its own.

## Technical notes

- `src/hooks/useBrtiFeed.ts`: add `visibilitychange` / `online` / `focus` listeners; on wake, run `cleanupSocket()` + `startCoinbase()` and clear any pending retry timer; drop `ticks` older than the sleep gap; derive `status` from last frame age (`FEED_TIMEOUT_MS`) instead of trusting the last socket event. Expose a `wakeCount` so consumers can react.
- `src/hooks/useBot.ts`: on the same wake signal, call the existing `pullRef.current()` (markets), `refreshPortfolio()`, `refreshServer()`, `refreshLive()`, `refreshAccuracy()` once, and clear the per-candle dedupe sets if the candle changed while asleep.
- No changes to gates, thresholds, order placement, or settlement. Live trading stays off.

## Verification

- Typecheck plus the existing bot test suite.
- In the preview: background the tab, wait, return, and confirm the feed reconnects and the panels refill without a manual reload.
