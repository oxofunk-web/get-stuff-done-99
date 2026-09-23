# Make the up/down call stable, and lock it only in the last 5 minutes

Today the reader keeps changing its UP/DOWN call during the whole 15-minute candle. You've seen it's most accurate in the last 5 minutes. The plan keeps the live reading exactly as it is and adds a steady layer on top.

## What you would see per coin

```text
0:00 - 10:00   WATCHING   leaning UP 58%   (grey, info only)
10:00 - 14:00  CALL: UP 81%   LOCKED at 10:12   (gold, won't flip on small wiggles)
14:00 - 15:00  FINAL: UP      (no changes, waiting for close)
after close    RESULT: WIN / LOSS  (compared to the real candle close)
```

## What gets added

1. **Three phases per candle** - "Watching" (first 10 min, lean only), "Call window" (last 5 min), "Final" (last minute, frozen).
2. **Lock rule** - A call only appears in the last 5 minutes and only after the chance stays above a set level (e.g. 70%) for about 20 seconds in a row.
3. **No-flip rule** - Once locked, the call only reverses if the price clearly crosses back over the candle's open by a meaningful amount and stays there, not on a one-second tick.
4. **Scorecard** - Every locked call is saved and graded against the real candle close. You get a win rate per coin and per minute of the candle, so we can prove where it's actually strongest (e.g. "calls locked at minute 12 win 84%").
5. **Tuning from real results** - After a few days of scores, adjust the lock level and start time per coin based on what actually won, not guesses.
6. **Optional alert** - A sound or on-screen flash when a call locks, so you don't have to stare at the screen.

## What does not change
The live price feed, the chart, and how the chance number is calculated today. No trading or orders are added back.

## Later (only if you want)
Once the scorecard shows a steady win rate, the same locked call could be sent to Kalshi as a single order per candle, with the existing $5 size and daily loss cap. That would be a separate decision.

## Technical notes
- Phase and lock logic as a pure function beside `src/lib/bot/direction.ts`, with hysteresis (enter above 70%, release only below ~45% plus crossing the open by >0.5 sigma for 20s).
- New `direction_calls` table (pair, candle start, locked_at, dir, prob, result), graded by the existing settle cron using the candle close from `getCoinCandles`.
- Scorecard panel groups results by pair and by lock minute.
