# Make the signals genuinely stable

The bot is OFF. Everything below is a repair to the decision quality, not a request to trade.

## What the live data since the reset actually shows

Across the 9 candles recorded after the reset:

- The bot's server side fired **248 times in only 15 pair/candle slots** — about 16 identical repeats per opportunity. The direction never flipped inside a slot (15 slots, 15 directions), so direction flapping is no longer the problem.
- The confidence number is **saturated**: 210 of 248 fired reads were labelled **99%**, average 98.4%. With the score pinned at the ceiling, the confidence threshold does almost nothing and every trade looks equally certain — which is exactly why a real loser could carry a "99%" label.
- Fired reads sit **far inside the money**: average cushion 2.9 standard deviations from the strike and average entry price **78¢**. 23 fired reads were beyond 3σ. Those are near-certainties bought at a price with almost no room left, so a single miss erases several wins.
- The biggest rejection reason by far is **"mid outside tradable band" (920 of 1,792)** — the bot keeps scoring contracts that are already priced out, then throws them away late.
- Current saved settings are a **custom** profile (86% threshold, 8% skew floor, 55% cushion floor, 2 trades) rather than a validated preset.

## Improvements

### 1. Stop the confidence number from saturating
- Rescale the score so the useful range spreads across the band instead of collapsing at 99. Cap the top at a value the evidence can support, and never display 99 unless a proven calibration band earns it.
- Show the number as a **score**, and show the calibrated probability separately with its sample count, so a score can never masquerade as a certainty.

### 2. Reward cushion in the right band, not "as deep as possible"
- Treat cushion as a **band with a ceiling**: below the floor is a coin flip, far beyond it is a near-certainty already fully priced. Score peaks in between and decays past a maximum.
- Enforce a **maximum entry price** for the leg being bought, so a 78–90¢ near-certainty is only taken when the calibrated edge genuinely justifies it.

### 3. One decision per pair per candle
- After a pair fires and either orders or skips, **lock that pair for the candle** instead of re-scoring it 16 more times.
- Keep only the decision plus a small sample trail, so accuracy statistics count one opportunity once rather than 16 duplicates.

### 4. Filter earlier, score later
- Apply the price-band, spread and depth checks **before** the score is computed, so the log stops filling with 920 already-priced-out contracts and the remaining rejections describe real near-misses.
- Require a minimum resting depth as part of that early pass, not only at order time.

### 5. Require agreement across time, not just one snapshot
- Extend stability confirmation from 2 samples to a longer window with a minimum elapsed spread, on the same ticker, same direction, same passing gates.
- Require the cushion to be **non-shrinking** across the confirmation window: a read that is decaying toward the strike is not stable.

### 6. Return to a known settings profile
- Replace the custom profile with the validated **Strict** preset plus the new entry-price ceiling and cushion band, so future results are attributable to one configuration.

### 7. Prove it before it matters
- Add tests for score de-saturation, the cushion band, the entry-price ceiling, per-candle locking, early filtering, and the longer confirmation window.
- Replay the recorded tape through old and new logic and report exactly which of the recorded fired reads the new rules would have suppressed, plus the score spread before and after.
- Then run one full window with the bot **OFF** and confirm one decision per pair per candle and a realistic score distribution.

## Technical notes

Changes are confined to `src/lib/bot/signals.ts` (score shaping, cushion band, entry ceiling, early gate ordering), `src/lib/bot/stability.ts` (confirmation window, non-shrinking cushion), `src/lib/bot/server-engine.server.ts` (per-candle pair lock, single decision record), `src/lib/bot/constants.ts` / `tuning.ts` (new band and ceiling settings), and the accuracy/signal panels for score-versus-probability wording. Existing `trade_log` history is preserved.

## Limitation

None of this predicts the market. It removes false certainty, duplicated evidence, and trades bought with no room left — the three things the recorded data shows are actually happening.
