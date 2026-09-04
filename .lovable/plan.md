# Why those 24 wins never became trades

I pulled the real log rows. The 24–1 record is not 25 missed trades. Three separate things are going on.

## 1. Those rows came from your browser, not the trader

Every one of the 24 winning `fired` rows in the last 12 hours has `source = client` — they were scored by the dashboard tab on your phone. Only the server bot places orders. The server, in the same candles, rejected those same pairs.

They are also duplicated: the tab re-logs the same pair each time it re-scores, so BTC alone contributed 8 of the 24 "wins" for one candle. Distinct opportunities were roughly 8, not 24.

## 2. The record is graded on direction, not on price — so it flatters itself

Example, candle 1987227: the tab fired `NO at 11¢` on BTC and it graded a win. The 11¢ in that label is the **YES mid**, not what a NO costs. A NO there actually costs about 89¢, so winning it returns ~12% per dollar risked, against real slippage and fees. The server priced it correctly and rejected it as "not enough value at this price."

So a chunk of that 24–1 is real reads that were not worth paying for. The label is what makes it look like free money.

## 3. Where trades were genuinely lost

Real losses of opportunity, from the same log:

- **Sampling gaps.** In the window the server only sampled ~24 five-second slices, with holes (615 -> 660, 740 -> 780). Each cron minute gives it a ~22s budget, so it is blind for most of each minute. Several of the tab's fires landed inside those holes.
- **Your current gate settings are tighter than the tab's.** `bot_settings` is on `custom`: confidence 82, price band 12¢–70¢, max spread 5¢, 2 trades per candle. The NEAR/BNB/SOL/ETH fires at 62¢–92¢ were above the 70¢ ceiling, so the server could never take them.
- **Execution.** In 24 hours the server sent 13 order attempts and 1 filled. The rest died on `Quote moved — now 88¢ vs the 71¢ scored (cap 74¢)` and `Book too thin`. The 3¢ slippage cap plus a one-per-candle attempt means a fast book kills the trade outright.

## What I will change

**Make the numbers honest**
- Show the actual cost of the leg (NO ask for a NO, YES ask for a YES) everywhere — signal card, log, accuracy panel — instead of the YES mid.
- Grade accuracy by money, not direction: split the panel into "direction right" and "would have been profitable at the price paid", and de-duplicate repeated rows so one signal counts once per pair per candle.
- Label client rows plainly as "monitor only — not traded" so the dashboard never implies the tab placed anything.

**Close the sampling holes**
- Continue sampling across the whole window instead of stopping when the per-minute budget runs out: shorter, more frequent passes and a resume point so the next tick picks up where the last stopped, with no dead stretches.

**Make execution actually fill**
- Widen the slippage rule to a value-based cap: allow paying up to the point where the edge falls under the EV margin, rather than a flat 3¢.
- Allow a second attempt per pair per candle at a re-scored price when the first failed on a moved quote, instead of writing the pair off.
- Size to resting depth so a thin book gets a smaller order rather than a "Book too thin" no-op.

**Reconcile the gates**
- One gate source for both the tab and the server, so the dashboard can never show a fire the trader would reject. When they differ, the card says which gate blocked it.

## Not changing

Signal math and direction logic, the 10:00 gate, the 7 pairs, live mode, bet size, trade count, or the $20 daily loss cap. No exit management is being reintroduced.

## Technical notes

- `src/lib/bot/signals.ts` — reason/label uses `entry`, not `ym`; expose the leg price on the signal.
- `src/components/bot/SignalsPanel.tsx`, `LogPanel.tsx`, `AccuracyPanel.tsx` — display leg cost, EV-weighted accuracy, dedupe by `(candle_id, pair, dir)`, "monitor only" tag on client rows.
- `src/lib/bot/server-engine.server.ts` — continuous sampling with a persisted resume offset; no idle gaps inside `GATE_SECS..CLOSE_SECS`.
- `src/lib/kalshi.server.ts` / `order-map.ts` — EV-derived `maxPriceCents`, depth-aware count, one retry on `quote_moved`.
- `src/hooks/useBot.ts` — read gates only from `bot_settings` so client and server share one truth.
