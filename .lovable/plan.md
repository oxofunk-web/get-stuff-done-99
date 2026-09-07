# Make signals survive an app refresh

## Confirmed cause

- The server runner is healthy: its latest heartbeat was at 06:01:50 UTC and the price tape is still receiving all seven pairs every minute.
- Refreshing the app clears the phone’s in-memory price history. The visible Signals panel then starts again from 1 reading and requires 60 current-candle readings before it can show a signal, even though the server already has the full candle history.
- The dashboard currently mixes two sources: signal cards come from the phone’s freshly reset feed, while the idle reasons come from older server decisions. That makes a working server look stopped after refresh.
- The saved bot switch is currently OFF. The runner continues analyzing and recording while off, but it will not place real orders. This plan will not turn real-money trading on automatically.

## Changes

1. Make the server runner the single source for the Signals panel, including direction, confidence, entry price, edge, reason, and timestamp for each pair.
2. Return only decisions from the current 15-minute candle and label their state clearly: confirming, ready signal, blocked, or stale. Do not reuse a previous candle’s reason after refresh.
3. Preserve visible signal continuity across reloads by rebuilding the screen from the current candle’s saved server observations instead of waiting for the phone to collect 60 new readings.
4. Show the server heartbeat and the bot switch separately: “scanner running” can coexist with “real orders off,” so the screen cannot imply that analysis stopped.
5. Keep the phone feed for live prices and charts only; it will no longer decide which signals the user sees or increments the visible signal count.
6. Remove the duplicate client-side signal/tape logging path so refreshing or opening multiple tabs cannot create conflicting telemetry.

## Safety and verification

- Do not erase trade history, learning results, or recorded market data.
- Do not change scoring math, thresholds, timing gates, trade sizing, or automatically enable live trading.
- Verify a signal/decision remains visible before and after a hard refresh, confirm the displayed candle matches the current candle, and confirm the server heartbeat continues advancing with the page closed and reopened.
- Run the existing signal, stability, ranking, and order tests plus a mobile-size browser check.
