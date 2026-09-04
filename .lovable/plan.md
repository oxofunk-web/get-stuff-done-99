# Is live trading working now?

Honest answer: the two bugs are fixed in code, but nothing has been proven live yet.

What the data currently shows:

- The runner is alive — last heartbeat seconds ago, "watching · outside trade window · 8 looks".
- Live trading is ON, $10 per bet, 3 trades per candle.
- The newest rows in the trade log are still the old "Quote moved — NO is now 88¢ vs the 71¢" failures from 05:40, before the fix. No trade window has opened since the change, so there is no post-fix evidence either way.
- The scheduled tick runs against the deployed build, not the editor sandbox, so the fix only takes effect once the app is published.

## Plan to confirm it actually trades

1. Publish, so the scheduled runner picks up the fixed code.
2. Watch one full 15-minute window (the trade gate opens at the 10:00 mark of each candle) and check three things in order:
   - Signals scored during the window carry the same market ticker as the order attempt.
   - No new "Quote moved" skips with a double-digit cent gap — that gap was the symptom of the stale-book bug.
   - At least one order reaches the exchange, or every skip has a legitimate reason (book too thin, edge gone, out of band, cap reached).
3. If orders still do not go out, capture the exact skip reason per pair from the signal log and report which gate is blocking, instead of guessing.

## Safety note

Live money is armed right now at $10 per trade, 3 per candle, with the -$20 daily loss cap. If you would rather confirm the fix before real orders fly, turn LIVE TRADING off for one window, watch the skip reasons, and turn it back on once the tickers line up.

## Technical notes

- `fetchOpenMarket` now selects the open market with the soonest future `close_time` instead of `limit=1`, so scoring and order pricing always use the same candle.
- The server runner seeds its book only from the current candle within the last 20 seconds, drops any quote it cannot re-confirm, and refuses to send an order if the ticker changed between scoring and submission.
- Verification uses `trade_log` and `signal_log` rows with `source = 'server'` for the candle that follows publishing.
