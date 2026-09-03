# Add BNB as a fifth trading pair

Add BNB alongside BTC, ETH, SOL and XRP everywhere pairs are listed, without touching signal logic, thresholds, order placement, or any other behavior.

Verified availability: Kalshi has an open 15-minute BNB series (KXBNB15M), and Coinbase publishes BNB-USD ticker data, so both the market feed and the price feed will work.

## What changes

- Pair list: add a BNB entry (Bitcoin-style config: name, Kalshi series KXBNB15M, Binance key bnbusdt, its own accent color).
- Price feeds: add BNB-USD to the Coinbase products/map, bnbusdt to the Binance stream URL and map. The server-side price fallback and server bot pick these up automatically since they read the same lists.
- Color token: add a BNB accent color variable in the stylesheet so its dot and label render like the other coins.

## What stays the same

- Trade cap stays at 4 per candle (one per pair, best signals win) — no change to sizing, gates, thresholds, EV margin, loss cap, or order code.
- No UI layout changes; BNB simply appears as another row/tile in the existing panels (spot grid becomes 5 tiles in the same 2-column grid).

## Technical notes

Files touched: `src/lib/bot/constants.ts` (PAIRS, PairId, WS_URL, WS_MAP, CB_PRODUCTS, CB_MAP) and `src/styles.css` (`--color-bnb` plus its text utility, matching how `--color-xrp` is defined).
