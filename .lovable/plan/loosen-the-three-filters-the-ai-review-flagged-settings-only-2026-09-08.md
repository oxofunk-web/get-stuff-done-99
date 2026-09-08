# Loosen the three filters the AI review flagged — settings only

## What the yellow lines say

The review panel's own analysis of settled trades found three filters blocking
mostly winners. The fix is three saved settings — no code, no UI, no threshold,
no loss-cap, and the bot stays OFF.

Current values (read live from the settings table):

- Strike distance: 0.20σ (spot must be at least this far from the strike)
- Book width: 0.09 (books wider than 9¢ are skipped)
- Flat book: 0.01 (book must lean at least 1¢)

## The change (three numbers, applied straight to the saved settings)

- Strike distance: 0.20 → 0.10 — trades much closer to the strike now qualify.
- Book width: 0.09 → 0.12 — wider/thinner books allowed through.
- Flat book: 0.01 → 0.005 — the book only needs to lean half a cent.

These go past the aggressive preset, as you asked ("more than 100%"). The
confidence dial stays at 72, the entry-price caps, value margin, depth check,
daily loss cap, and live/paper state are untouched.

## One thing a setting can't do

The third yellow line's "YES-side placement" block is a code rule, not a
setting — and the engine already flips to the other side of the strike instead
of skipping, so that one is effectively handled. Only the strike-distance part
of that bullet is a setting, and it's being halved here.

## Technical detail

- Applied via the existing `updateServerBot` server function path (same one the
  dashboard dials use): `minSigmaDist: 0.10`, `maxSpread: 0.12`,
  `minSkew: 0.005`. Hand-tuning gates auto-marks the preset as "custom",
  which matches the current state.
- Bot remains disabled; nothing turns on.

## Verification

Re-read the settings row to confirm the three values landed, and confirm the
dashboard gate panel shows them.
