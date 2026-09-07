# Fix the misleading "not enough live data" message

## What's actually happening

The trading brain lives on the server, and it has plenty of data: over the last
two candles it recorded 165-175 price readings per pair, scored every pair
repeatedly, and even fired two BTC signals in the last half hour. Nothing is
starving.

The "not enough live data yet" line you see comes from a *second, separate* copy
of the scoring logic that runs inside your phone's browser purely for display.
That copy counts only the price frames your own phone received during the current
15-minute candle, and it needs 60 of them. Two things keep it under 60:

- Every new candle resets the count to zero, and every time the phone screen
  wakes the feed is rebuilt from scratch, so the count restarts.
- Thin pairs (NEAR, BNB, DOGE) simply don't print 60 price updates in a candle,
  so for those the panel can say "not enough live data" for the whole candle even
  while the server is scoring them normally.

So the message is a display bug, not a trading problem.

Also stale: the idle panel still reads "Trade window opens at the 10:00 mark"
even though the window now opens at 5:00.

## The fix

- Show the *server's* reasons in the "WHY EACH PAIR IS IDLE" strip instead of the
  browser's. The server already writes a reason per pair per look, so the panel
  will read what the real trader actually thought ("book too flat", "spot too
  close to the strike", "missed by 0.8"), with a timestamp of the last look.
- Stop the browser copy from claiming a data shortage. It keeps computing for the
  live tiles, but when its own history is thin it says "waiting on the server's
  read" rather than presenting itself as the decision.
- Fix the window-open copy to follow the actual setting (5:00) instead of a
  hardcoded 10:00, in the signals panel and the clock panel.

## Technical detail

1. `src/lib/bot/telemetry.functions.ts`: add a per-pair "latest server look"
   query — most recent `signal_log` row per pair for the current candle
   (`source='server'`), returning pair, verdict, reason, `seconds_in`, `ts`.
2. `src/hooks/useBot.ts`: `pairStatus` prefers those server rows; the local
   `getSignalTrace()` result is only the fallback when the server has not looked
   yet this candle. Drop `not enough live data yet` from what gets surfaced —
   replace with "waiting on the server's first look this candle".
3. `src/components/bot/SignalsPanel.tsx`: `EmptyState` uses the live `gateSecs`
   from tuning (already loaded) instead of the imported `GATE_SECS`, and prints
   the real mm:ss; the idle strip shows the server look's age.
4. `src/components/bot/ClockPanel.tsx`: same copy fix if it hardcodes 10:00.
5. No change to gates, thresholds, sizing, or the live/paper switch.

## Verification

`bunx tsgo --noEmit`, `bunx vitest run`, then watch one full candle on the phone
and confirm the idle strip mirrors the server reasons and never says the data is
missing.

## Note

The bot is currently OFF and in paper mode with threshold 80. Say the word if you
want it switched back to live as part of this.
