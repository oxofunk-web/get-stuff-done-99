# Learn from real fills only, and start looking earlier in the candle

Two changes: make sure every filled trade ends with a recorded, exchange-confirmed
result that feeds confidence, and open the scoring window closer to the start of
the candle instead of waiting until the 10-minute mark.

## Part 1 — every fill gets a real result

What already works: filled trades store the actual filled contracts and the real
average price paid, results are graded from the exchange's finalized result for
that exact contract, and confidence is rebuilt only from settled real fills of the
current strategy (never from hypothetical or rejected signals). All 14 historical
fills are graded.

What is missing:

- Nothing chases a fill whose result the exchange hasn't published yet. Such a row
  stays ungraded forever, silently shrinking the pool confidence learns from.
- Results only land when the scheduled settlement pass runs, so learning can lag
  the market by a long stretch.
- Nothing on screen says how far the bot is from having enough real results to
  trust its own confidence numbers, so "unproven" looks like a bug.

Changes:

- Track settlement attempts per trade (`settle_attempts`, `settle_checked_at` on
  `trade_log`). Each pass retries ungraded fills oldest-first with a widening gap.
- After 8 attempts and more than an hour past the candle's close, mark the trade
  `void` with zero profit/loss and a note saying the exchange never published a
  result. Void trades stay visible, are excluded from win rate and from
  confidence learning, and are counted separately so the gap is honest.
- Run a settlement pass at the end of every bot tick, in addition to the schedule,
  so a fill is usually graded within a couple of minutes of the candle closing.
- Show learning progress: "real results: N of 50 needed" on the accuracy panel,
  plus per-pair real-fill counts, so the unproven state is explained rather than
  mysterious.

## Part 2 — open the scoring window earlier

Today scoring cannot start before 10:00 into a 15-minute candle, which leaves at
most a 4-minute window (minus the order cutoff).

- Move the window open from 10:00 to 5:00 (`GATE_SECS` 600 -> 300). Closing stays
  at 14:00 with the existing 5-second order cutoff.
- Readiness becomes data-driven rather than clock-driven: the 60-readings-inside-
  this-candle requirement already lands about 2.5 minutes in, so the real gate is
  "enough current-candle data", with the clock only preventing a cold start.
- No threshold change is needed for the earlier entries: the cushion is measured
  in expected standard deviations to settlement, so a 5:00 entry automatically
  demands a much larger price cushion than a 12:00 entry. Earlier looks are
  therefore harder to pass, not easier.
- One decision per pair per candle still holds, so the first read that clears every
  gate is the one taken — the longer window means more chances to find it, not
  more trades per candle.
- Make the window open time adjustable without a deploy (`gate_secs` on
  `bot_settings`, wired through the existing tuning object and the engine panel).

## Technical detail

1. Migration: add `settle_attempts integer not null default 0`,
   `settle_checked_at timestamptz` to `trade_log`; add
   `gate_secs integer not null default 300` to `bot_settings`.
2. `src/lib/bot/settle.server.ts`: increment attempts/stamp each check; void rule
   above; keep grading by finalized exchange result and exact ticker.
3. `src/lib/bot/server-engine.server.ts`: call `settlePending` once per tick after
   the sampling loop; exclude `outcome = 'void'` from `loadCalibration` and from
   the daily loss-cap settled figure (its stake is released, not lost).
4. `src/lib/bot/constants.ts`: `GATE_SECS` 600 -> 300.
5. `src/lib/bot/tuning.ts` + `useBot.ts` + `EnginePanel.tsx`: load `gate_secs`
   into tuning, expose a control, keep `closeSecs` fixed.
6. Copy updates in `candle.ts` phases, `ClockPanel`, `SignalsPanel`, `EnginePanel`
   (no more "opens at the 10:00 mark").
7. `AccuracyPanel.tsx` / `telemetry.functions.ts`: real-result count vs the
   50-sample requirement, void count shown separately.
8. Tests: void-after-retries grading, void excluded from calibration, signals fire
   at 5:30 into a candle when 60 readings exist and are rejected at 4:00.

## Verification

`bunx tsgo --noEmit`, `bunx vitest run`, then one full OFF candle observation
confirming looks start around 5:00-5:30 and the reason lines make sense.

## Not included

Live trading stays OFF; no change to bet size, thresholds, or the daily loss cap.
