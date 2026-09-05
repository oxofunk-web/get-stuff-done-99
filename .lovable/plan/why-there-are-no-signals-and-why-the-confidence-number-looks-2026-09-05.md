# Why there are no signals, and why the confidence number looks stuck

I pulled the live rows just now. Nothing is broken in the plumbing — the tick ran at 08:43 and reported `tape ok · 0 live signal(s) · server bot OFF · 17 looks`.

## 1. The minimum-confidence dial is set above what the new scoring can reach

Saved settings are a **custom** profile with **minimum confidence 88**. When I rebuilt the score to stop it shouting "99%" at everything, the new curve deliberately spreads out and tops out near **90** (an unproven score is capped at 90 for display). So a dial at 88 leaves a sliver of a sliver.

Rejections in the last 40 minutes:

| Reason | Count |
| --- | --- |
| outside the trade window | 259 |
| mid outside tradable band | 140 |
| confidence below threshold | 125 |
| not enough live data yet | 102 |
| spot momentum fights the direction | 59 |
| leg costs too much to leave any room | 37 |
| book too flat | 31 |
| book too wide | 18 |

The highest score recorded in that window was exactly **90.0** — the cap. A handful of reads did pass everything and were sitting in "waiting for a second matching live sample".

## 2. Confidence is a reading of the market, not a setting

The dial is a **filter**: it decides which reads are allowed through. It does not raise or lower the confidence printed on a read — that comes from the book lean, momentum, cushion and spread. So moving it will never change the number shown; it only changes how many reads survive.

Two things do make it look frozen, and those are real defects:

- Every strong read is clamped to exactly **90**, so a whole range of quality collapses onto one number again — the same saturation problem, just at a lower value.
- The dial goes up to **95**, above anything the display can ever show, so the top of the slider is a dead zone where nothing can ever fire.

## What I will change

1. **Put the dial back on a sane range and value.** Cap the slider at what the score can actually reach, and reset the saved profile to **Balanced** (72) instead of the custom 88.
2. **Stop the score clamping onto one number.** Keep the top of the range reserved, but let scores below it stay distinct so the dial can actually discriminate, and show the ceiling on screen so it is obvious where the top is.
3. **Show the number that is being judged.** The panel will show the same score the gate compares, alongside the calibrated probability and its sample count, so a score can never read as a certainty.
4. **Make the wait message honest.** Confirmation now needs three matching samples, but the message still says "waiting for a second matching live sample" — it will state how many samples are still needed.
5. **Name the top blocker on the dashboard.** A one-line summary above the gates: the reason that killed the most reads this candle and by how much they missed, so silence is explained rather than guessed at.
6. **Sanity note on the price band.** 140 reads were priced out of the 8–94¢ band and 37 legs cost more than the entry ceiling. I will leave both alone for now: they are the guards added on purpose after the 78¢ losses. If you also want those widened, say so and I will include it.

Live trading stays **off** through all of this. Nothing here arms money.

## Technical notes

- Reset `bot_settings` to the balanced preset via the existing update path (`gate_preset = 'balanced'`, `threshold = 72`).
- `src/lib/bot/constants.ts`: reconcile `SCORE_CAP_UNPROVEN` / `SCORE_CAP_PROVEN` with `SCORE_SPAN`; apply a soft roll-off instead of `Math.min`.
- `src/lib/bot/signals.ts`: compare the gate against the same displayed value; keep the rejection payload carrying the miss margin.
- `src/lib/bot/stability.ts`: message reflects `REQUIRED_STABLE_SAMPLES`.
- `src/components/bot/EnginePanel.tsx`: slider `max` follows the score ceiling; add the "top blocker" line; `SignalsPanel` shows score plus calibrated probability with sample count.
- Tests extended in `signals.test.ts` / `stability.test.ts` for the roll-off and the sample-count message.
