# Remove NEAR and BNB pairs

Remove the NEAR and BNB trading pairs so only BTC, ETH, SOL, XRP and DOGE remain. Nothing else changes.

## What changes

- Pair list: drop the BNB and NEAR entries (name, Kalshi series, stream key, color).
- Price feeds: drop the BNB-USD and NEAR-USD Coinbase products and the bnbusdt/nearusdt Binance streams from the existing lists. The server-side price fallback and the server bot stop following those coins automatically because they read the same lists.
- Colors: remove the unused BNB and NEAR color tokens.

## What stays the same

- No change to thresholds, EV margin, gates, sizing, daily loss cap, or order placement.
- Trade cap per candle stays as-is; with 5 pairs it simply has fewer pairs to pick from.
- No layout changes; the two coins disappear from the existing panels.
- Live trading stays off. Historical trades and stats for BNB/NEAR stay in the record untouched.

## Technical notes

Files touched: `src/lib/bot/constants.ts` (PairId, PAIRS, WS_URL, WS_MAP, CB_PRODUCTS, CB_MAP) and `src/styles.css` (`--color-bnb`, `--color-near`). Verified: every panel and the engine read these lists, so no other file needs changes. One test file mentions "BNB" only as an arbitrary pair name — left as-is unless the type change forces a fix.
