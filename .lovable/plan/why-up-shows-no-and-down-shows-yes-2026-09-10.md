# Why "up" shows NO and "down" shows YES

## What the records actually say

I checked every read the bot fired in the last 7 days (2,921 graded reads, current strategy):

- 71% of them won, and they averaged a real gain of about 4 cents per dollar risked.
- Every single fired read was pointed at the side of the strike price the coin was actually on. None were pointed the wrong way.
- 538 of them pointed *against* the short-term price wiggle — and those won 72.7%, slightly more often than the ones that agreed with the wiggle (70.8%).

So the picks are not inverted. What is confusing is how the card explains itself.

## What is really happening

Each 15-minute contract asks one question: will the coin finish **above a fixed line**?

- YES wins if it finishes above the line.
- NO wins if it finishes below the line.

The bot picks its side from where the coin sits relative to that line and how far it is, not from whether the last few seconds ticked up or down. So a coin that is well below the line, ticking up slightly, is still a NO — and that is usually correct, because a small upward wiggle rarely covers the remaining distance in the time left.

The card currently shows a "▲ YES / ▼ NO" arrow right next to a "BRTI Δ +0.004%" up-tick. Two arrows pointing opposite ways on the same card is what makes it read like a wrong signal.

## The fix (display only)

Change the signal card so it states the bet in plain terms and stops implying a price-direction arrow:

1. Replace "▲ YES / ▼ NO" with the bet itself, e.g. **"BTC finishes ABOVE 78,407"** / **"BTC finishes BELOW 78,407"**. Colour stays as it is now.
2. Add a line showing distance to the line: coin price, the line, and how far away it is (e.g. "now 78,340 · line 78,407 · 68 below").
3. Relabel "BRTI Δ" to "LAST 10s DRIFT" so it clearly reads as recent noise, not the bot's view.
4. In the explanation sentence, when the drift runs opposite the chosen side, say so directly: "drifting up but still 68 below the line with 4:12 left".

No change to how the bot chooses, prices, or filters trades. Nothing about live trading changes; it stays off and in paper mode.

## Technical notes

- `src/components/bot/SignalsPanel.tsx`: swap the YES/NO arrow badge for the above/below phrasing, add the spot-vs-strike row, relabel the momentum stat.
- The card needs `strike` and `strikeType` on the signal it renders; if the server-read mapping in `src/lib/bot/useBot`/`telemetry.functions.ts` does not already carry them through to the card, pass them through (data is already stored per read).
- `src/lib/bot/signals.ts` reason text: add the drift-vs-cushion clause. Scoring, gates and thresholds untouched.
