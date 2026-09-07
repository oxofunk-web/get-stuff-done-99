# Stop tiny momentum wiggles from vetoing good signals

Goal: keep protection against a real reversal, but stop treating every microscopic opposite tick as a reason to reject an otherwise qualified signal. Live trading stays OFF.

## What the live data shows

- The current rule rejects whenever short momentum has the opposite sign, even if the move is almost zero.
- In the latest three-minute sample it produced 89 repeated rejection snapshots. The opposing moves ranged from about 0.008% to 0.055%, all below the existing 0.12% threshold used to identify meaningful spot movement.
- Those snapshots are not independent settled trades, so they will not be presented as 89 missed wins. The repair will be validated by candle-level outcomes rather than poll counts.

## Changes

1. Replace the zero-tolerance veto with a material-reversal check:
   - Ignore tiny opposite short-term momentum below half the established movement threshold (0.06%).
   - Reject only when short-term momentum is at least 0.06% against the chosen side **and** the broader momentum also points against it.
   - Keep the book-direction, strike-side, cushion, price, depth, confidence, and confirmation protections unchanged.

2. Make the rejection self-explaining:
   - Report short momentum, broader momentum, and the 0.06% reversal threshold when a real reversal blocks the signal.
   - Use wording that distinguishes a confirmed reversal from harmless noise.

3. Add focused tests:
   - A tiny opposite move no longer blocks an otherwise valid signal.
   - A brief short-term dip with supportive broader momentum does not block.
   - A material short- and broader-term reversal still blocks.
   - Existing price, cushion, and current-candle data gates continue to pass their tests.

## Validation

- Run the signal tests and type checks.
- Observe at least one full candle with trading OFF and compare unique candle/pair decisions, not repeated polling rows.
- Confirm signals can progress past this rule while genuine reversals still show a clear rejection.

## Not included

No changes to score thresholds, gate timing, entry-price cap, stake, daily risk limit, or the live-trading switch.
