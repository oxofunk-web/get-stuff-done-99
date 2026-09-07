# Let good reads through: price cap, strike side, and flat-book rules

Looking at the last two days of real decisions, these three rules are throwing away most of the bot's opportunities — and the recorded outcomes say two of them are throwing away winners.

## What the data says

- "Leg costs too much" — 3,034 blocked, 2,072 later graded, 90% of them won. Even at the high prices they were blocked for (65-89¢), the graded ones average a clear profit per contract. This rule is the biggest avoidable loss of opportunity.
- "Spot is outside the YES/NO side of the strike" — 1,075 blocked, 879 graded, 81% won. That pattern says the direction was picked wrong first, and then the read was thrown away instead of simply being flipped to the side spot actually supports.
- "Book too flat" — 1,481 blocked, 989 graded, only 57% won. This one is close to a coin flip, so it stays, but it should not fire when the read has real evidence behind it.

## Changes

1. Price cap becomes value-based, not a flat ceiling
   - Replace the hard 60¢ ceiling with a two-part test: the leg may cost more when the expected value per dollar still clears the margin, with an absolute upper limit at 90¢ (no near-certainties priced at 95¢+).
   - Until confidence is proven, keep a conservative interim ceiling of 80¢ so an unproven score cannot buy an expensive leg.
   - The rejection note reports the price, the value at that price, and which of the two limits refused it.

2. Wrong side of the strike flips the trade instead of killing it
   - When the chosen direction sits on the losing side of the strike but the other side has a real cushion, switch the direction to the side spot supports and continue through every remaining rule (book direction, cushion band, price, depth, value, confirmation).
   - Reject only when neither side has a usable cushion, and say so plainly.

3. Flat book only blocks weak reads
   - Lower the minimum book lean to 0.01 (from 0.02).
   - Allow a read with a lean below that minimum through when the cushion is at or above the strong-cushion level and momentum agrees with the direction; otherwise keep rejecting.
   - The note distinguishes "flat book, no other evidence" from "flat book but strong cushion".

4. Keep every safety rule that the data supports
   - Cushion band, spread, depth, confirmation samples, the confirmed-reversal check, and the daily loss cap are untouched.
   - Live trading stays off; these changes are observed on shadow reads first.

## Proving it

- Typecheck and the full bot test suite.
- New tests: an 82¢ leg with enough value passes and a 92¢ leg never does; a read on the wrong strike side flips and continues; a flat book with strong cushion passes while a flat book with nothing else still rejects.
- Watch one candle with trading off and confirm reads now progress past these three rules, then compare graded outcomes of the newly allowed reads before enabling live.

## Technical notes

- `src/lib/bot/constants.ts`: `MIN_SKEW` 0.02 -> 0.01; add `MAX_ENTRY_PRICE_PROVEN = 0.9`, `MAX_ENTRY_PRICE_UNPROVEN = 0.8`, `STRONG_CUSHION_SIGMA` for the flat-book override.
- `src/lib/bot/tuning.ts`: expose the new ceilings so the offline tuner can sweep them.
- `src/lib/bot/signals.ts`: move direction resolution so the strike-side check can flip `dir` and recompute `dirCushion`, entry, calibrated probability and EV; replace the flat entry gate with the value-plus-ceiling test; add the strong-cushion exemption to the skew gate.
- `src/lib/bot/signals.test.ts`: cases above.
