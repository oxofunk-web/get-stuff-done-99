# Raise the price ceiling, discount score on high-probability legs, single-sample confirmation

Three changes: let pricier contracts through, require less confidence when a leg is already heavily favored, and fire on the first matching sample instead of waiting for three.

## 1. Raise the maximum contract price

Today two ceilings exist in code, and the tighter one is what's live:

- Absolute ceiling: 90¢
- Unproven-accuracy ceiling: 80¢ (applies right now, because accuracy isn't proven yet)

This is why reads at 82–89¢ were being turned away. Change:

- Absolute ceiling: 90¢ -> **95¢**
- Unproven ceiling: 80¢ -> **90¢**

The value check still applies above 60¢ — an expensive leg must still be justified by its expected value, so this doesn't open the door to overpaying blindly.

## 2. Loosen the score requirement on high-probability legs

When the leg itself is priced like a near-certainty (75¢ or more), the market already agrees with the read, so demanding the full 72-point confidence dial is double-counting. New rule in the scoring code:

- Legs priced at **75¢ or more** get a **10-point discount** on the confidence dial (currently 72 -> effective 62).
- Legs below 75¢ keep the full dial, untouched.

## 3. Confirmation: 3 matching samples -> 1

Today a signal must be seen 3 times, at least 6 seconds apart, with no cushion decay, before it can fire. Change to:

- **1 matching sample** — a read that passes every other filter can fire immediately.
- The cushion-decay protection and the fresh-quote re-check right before an order stays, so a signal that flips still can't trade.

## What stays the same

- The bot stays **off** and in paper mode; nothing here arms live orders.
- Strike cushion (0.35σ), book lean, spread, depth, price band (8–94¢), expected-value margin, per-candle trade limit, and the daily loss cap are untouched.
- The fresh-quote revalidation immediately before order submission still runs.

## Technical notes

- `src/lib/bot/constants.ts`: `MAX_ENTRY_PRICE` 0.9 -> 0.95, `MAX_ENTRY_PRICE_UNPROVEN` 0.8 -> 0.9.
- `src/lib/bot/signals.ts`: effective threshold = `T.threshold - 10` when `entry >= 0.75` (new small constant, e.g. `HIGH_PROB_PRICE = 0.75` / `HIGH_PROB_THRESHOLD_DISCOUNT = 10`).
- `src/lib/bot/stability.ts`: `REQUIRED_STABLE_SAMPLES` 3 -> 1, `REQUIRED_STABLE_SPAN_MS` 6000 -> 0; keep `CUSHION_DECAY_TOLERANCE` machinery intact.
- `src/lib/bot/server-engine.server.ts`: update the "confirming — x of 3" status line for the single-sample window.
- Update `stability.test.ts` (and any test asserting the old ceilings/thresholds) to match.

## Verification

Run the typecheck and the bot test suite; confirm the dashboard shows the new ceilings in the block reasons when a pricey leg is rejected.
