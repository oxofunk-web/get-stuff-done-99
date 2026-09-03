# Add BNB, NEAR and DOGE as trading pairs

Add three new pairs alongside BTC, ETH, SOL and XRP, changing nothing else about how the bot thinks or trades.

Verified availability: Kalshi has live 15-minute series for all three (KXBNB15M, KXNEAR15M, KXDOGE15M), and Coinbase publishes live spot for BNB-USD, NEAR-USD and DOGE-USD — so both the market feed and the price feed work exactly like the existing coins.

Gold and WTI are not included: Kalshi only lists them as daily/hourly markets and there is no matching real-time spot feed, so they'd need a separate design.

## What changes

- Pair list: three new entries (name, Kalshi 15-minute series, Binance stream key, accent color).
- Price feeds: add the three Coinbase products and Binance streams to the existing lists. The server-side price fallback and the server bot pick them up automatically because they read the same lists.
- Colors: add accent color tokens for BNB, NEAR and DOGE so their dots and labels render like the other coins.

## What stays the same

- Trade cap stays at 4 per candle, one per pair — with 7 pairs it simply picks the best 4 signals.
- No change to thresholds, EV margin, gates, sizing, daily loss cap, or order placement.
- No layout changes; the new coins appear as extra tiles/rows in the existing panels.

## Technical notes

Files touched: `src/lib/bot/constants.ts` (PairId, PAIRS, WS_URL, WS_MAP, CB_PRODUCTS, CB_MAP) and `src/styles.css` (`--color-bnb`, `--color-near`, `--color-doge` plus their text utilities, matching `--color-xrp`).
