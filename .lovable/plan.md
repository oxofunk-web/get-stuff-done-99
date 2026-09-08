# Remove BNB, NEAR, DOGE and tune the dial + cushion

Two changes only: cut three coins, and retune the confidence dial and cushion settings so more reads that genuinely land on the right side of the strike are allowed to fire.

## Remove BNB, NEAR and DOGE

Only BTC, ETH, SOL and XRP remain.

- Pair list: drop the BNB, NEAR and DOGE entries (name, Kalshi series, stream key, color).
- Price feeds: drop BNB-USD, NEAR-USD, DOGE-USD from the Coinbase list and bnbusdt/nearusdt/dogeusdt from the Binance stream. The server bot and the server-side price fallback stop following them automatically because they read the same lists.
- Colors: remove the now-unused BNB, NEAR and DOGE color tokens.
- Past trades and stats for those coins stay in the record; they simply stop being traded and stop appearing in the panels.

## Tune the dial and cushion

Based on the bot's own graded history (54,000+ graded reads, current strategy):

| Confidence | Reads | Landed right |
|---|---|---|
| 55–60 | 2,380 | 62.5% |
| 60–65 | 6,331 | 76.7% |
| 65–70 | 9,817 | 78.9% |
| 70–75 | 12,638 | 79.2% |
| 75–80 | 12,199 | 78.7% |
| 85+ | 1,863 | 69.9% |

Accuracy is flat from 60 up to 85 and gets *worse* above 85, so the current 72 dial is throwing away thousands of equally accurate reads for nothing.

| Cushion (sigma) | Reads | Landed right |
|---|---|---|
| 0.00–0.50 | 10,980 | 59% |
| 0.50–1.00 | 8,303 | 78% |
| 1.00–1.50 | 4,392 | 85% |
| 1.50–2.00 | 1,984 | 87% |
| 2.00+ | 1,236 | 88% |

Below half a sigma accuracy falls off a cliff, so cushion should not be loosened past that.

Settings changed (saved settings only, no rule rewrites):

- Confidence dial: 72 -> **62** (opens up the whole flat-accuracy band)
- Cushion minimum: 0.55 -> **0.50** (keeps the 78%+ zone, drops the coin-flip zone)
- Book lean minimum: 0.04 -> **0.01** (this was blocking reads that had real cushion behind them)
- Expected-value margin: 0.10 -> **0.05** (0.10 was the single strictest gate and rejected priced-fair favourites)

## What stays the same

- Trading stays off and in paper mode. Nothing here turns on live orders.
- Price caps, depth requirement, spread limit, band ceiling, confirmation, per-pair cooldowns and the daily loss cap are untouched.
- No layout or logic changes.

## Technical notes

`src/lib/bot/constants.ts` (PairId, PAIRS, WS_URL, WS_MAP, CB_PRODUCTS, CB_MAP) and `src/styles.css` (`--color-bnb`, `--color-near`, `--color-doge`). Settings are updated in the `bot_settings` row (`threshold`, `min_sigma_dist`, `min_skew`, `ev_margin`); `gate_preset` stays `custom`. Every panel and the engine read the pair list, so no other file changes.
