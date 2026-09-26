# Auto-trade on locked calls, even with the app closed

Your live reading, chart, chance numbers and lock rules stay exactly as they are. This only adds new pieces.

## What you get

- **AUTO-TRADE switch (ON / OFF).** Starts OFF. Only you turn it on.
- **Trade size buttons: $10 / $45 / $100.**
- **Trades only when a call locks** in the last 5 minutes. One trade per coin per candle. A later flip never places a second trade.
- **Runs with the app closed.** A copy of the same lock check runs on the server about every minute, using the same live prices. So it keeps watching and trading while your phone is locked.
- Each locked call shows FILLED at X¢ or SKIPPED with the reason.

## How a trade is picked

1. Call locks (e.g. BTC UP 81%).
2. The bot finds that coin's current 15-minute Kalshi contract and buys the side that matches (UP = finishes above Kalshi's line, DOWN = below).
3. It skips if Kalshi's line is on the wrong side of your call, the contract costs over 90¢, or the book is empty.

## Safety kept

- Existing daily loss cap still applies (currently $20; at $45 or $100 sizes one loss hits it, so you may want to raise it).
- A single fill-or-cancel order, no chasing the price.

## Your new Kalshi key

You pasted the private key into chat, so treat it as exposed. I'd recommend making a fresh key in Kalshi. Either way, after you approve I'll open a secure form where you paste the key ID and private key. They'll be saved privately, not in chat or code.

## Important limits

- Your call compares to the candle's open price. Kalshi pays on its own line. They're usually close but not always the same.
- The server checks less often than the open app does, so a lock can land a few seconds later.

## Technical notes

- New `src/lib/bot/autotrade.server.ts`: per pair, gather ~20s of spot samples, reuse `directionCall` + `stepLock` unchanged, persist lock state in `direction_calls`, then trade using `fetchOpenMarketWithReason` + existing `placeLiveOrder`; write `trade_log` with `source='lock'`. Uniqueness checked per pair+candle.
- New cron route `src/routes/api/public/autotrade.ts` (verified with the existing cron token), scheduled every minute via pg_cron.
- New `bot_settings` columns (additive): `auto_trade_enabled boolean default false`, `auto_trade_size numeric default 10`.
- New server fns get/set these; `LockPanel` gets the switch, size buttons and status lines.
- Update `KALSHI_API_KEY_ID` / `KALSHI_PRIVATE_KEY` through the secure form.
- No changes to direction, lock, chart, or existing signal code.
