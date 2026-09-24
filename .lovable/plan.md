# Auto-trade only when a call locks

The reader, chart, chances and lock rules stay exactly as they are. The only addition: the moment a coin's call locks (last 5 minutes), the bot places one Kalshi order for that call.

## How it works

1. A call locks (e.g. BTC FINISHING UP, 81%).
2. The bot finds that coin's current 15-minute Kalshi contract and buys the matching side (UP = "price above the line", DOWN = "price below the line").
3. One order per coin per candle, never more. A flip after locking does not place a second order.
4. The result is shown next to the locked call: FILLED at X¢, or SKIPPED with the reason.

## Safety kept on

- Fixed $5 per trade, $20 daily loss cap (existing settings).
- Won't buy if the contract costs more than 90¢ or the price jumped more than 3¢ since the lock.
- An on-screen AUTO-TRADE switch, OFF by default, plus a "LIVE MONEY" confirm. Only you turn it on.

## Important limits

- Your calls compare to the candle's **open price**; Kalshi pays on its own **line**, which can differ. If the line is on the wrong side of your call (e.g. you say UP but price is already below Kalshi's line), the order is skipped and the reason says so.
- Orders fire only while the app is open on screen, the same as calls being saved today.

## Technical notes

- New server function `placeLockTrade` in a new file: reads `bot_settings` (enabled, live confirm, bet size, loss cap via `bot_risk_snapshot`), picks market with `fetchOpenMarketWithReason`, checks line side vs call, calls existing `placeLiveOrder`, writes to `trade_log` with `source='lock'`. Unique per pair+candle enforced by checking `trade_log` first.
- `useLockedCalls` calls it right after `recordLock` when auto-trade is on; `LockPanel` gets the switch and order status line.
- No changes to direction, lock, chart, or signal code.
