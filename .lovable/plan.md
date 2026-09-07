# Require more price history, and only from the current candle

Goal: make the momentum and volatility math trust a real sample of the current
15-minute candle instead of a thin or mixed-up price history. Live trading stays
OFF; this only changes what counts as "enough data".

## What changes for you

- The bot needs about 60 price readings inside the candle before it will score
  anything, up from 24. It still opens at the 10-minute mark, so nothing gets
  slower in practice — the server collects a reading every 2.5 seconds, so 60
  readings are in hand roughly 2.5 minutes into the candle.
- Prices from the previous candle can no longer leak into the current candle's
  momentum and volatility. Right now the browser keeps a rolling list of the last
  120 readings regardless of which candle they came from, so a fresh candle can be
  judged partly on the old one's behaviour.
- The "not enough live data yet" note now says how many readings are in and how
  many are needed, so a skipped candle is self-explaining.

## Technical detail

1. `src/lib/bot/constants.ts`
   - `MIN_TICKS: 24 -> 60`.
   - Add `TICK_LOOKBACK = 60` and use it for the volatility window so the
     requirement and the window stay in step.

2. `src/hooks/useBrtiFeed.ts`
   - In `push`, drop readings older than the current candle start
     (`candleInfo(now).start`) before appending, instead of only trimming to 120.
   - Keep the 120-entry cap as a memory guard.

3. `src/lib/bot/signals.ts`
   - Volatility window uses `TICK_LOOKBACK` (`slice(-60)`, unchanged in value).
   - The `minTicks` rejection payload keeps `ticks` and adds `needed`, so the
     reason line can read `28/60 readings`.
   - Momentum guards (`< 4`, `< 8`) stay as they are; they are only crash guards
     now that the gate is 60.

4. `src/lib/bot/server-engine.server.ts`
   - Tape query is already scoped by `candle_id`, so no leakage there; update the
     comment at line 54 that still says "~24 ticks".

5. Tests (`src/lib/bot/__tests__/signals.test.ts`)
   - A tape of 40 readings is rejected with the `needed: 60` payload.
   - A tape of 60 readings passes the data gate.
   - Readings stamped before the candle start do not count toward the gate.

## Verification

`bunx tsgo --noEmit`, `bunx vitest run`, then one OFF observation across a full
trade window confirming the reason line shows the readings count and that signals
still appear after the 10-minute gate.

## Not included

No change to thresholds, gate timing, bet size, or the live/paper switch.
