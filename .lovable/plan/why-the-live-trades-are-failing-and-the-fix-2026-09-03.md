# Why the live trades are failing — and the fix

I pulled the real trade log. The failures are not the API key. Two concrete bugs are causing both the "No resting volume" spam and the bad fills.

## What the log shows

```text
01:42:31–33  BTC  failed x7  "No resting volume ... canceled safely"
01:42:34     BTC  YES x14 @ 69¢ · filled 14 @ 83¢   -> loss
01:42:43     XRP  YES x11 @ 88¢ · filled  4 @ 95¢   -> loss
01:42:50     ETH  YES x12 @ 80¢ · filled 12 @ 87¢   -> loss
01:58:36     DOGE YES x17 @ 57¢ · filled 17 @ 16¢   -> loss (price units wrong)
```

1. **Retry storm.** When an order fails, the bot un-counts the trade and un-marks the pair, so the very next tick fires the same order again — 4 to 7 attempts per second. Each attempt crosses the book a bit harder, so the loop keeps pushing until something fills at a terrible price.
2. **No slippage guard.** The signal is scored at, say, 69¢ but the order fills at 83¢. An 86%-confidence bet bought at 83¢ has almost no edge left — that alone explains the string of losses even when direction was right.
3. **Fill price is mis-scaled.** DOGE logged "filled 17 @ 16¢" for a 57¢ quote. Kalshi's `average_fill_price` is being multiplied by 100 unconditionally, so P&L and entry price are wrong in the log.

## What I'll change

- **Kill the retry storm:** a failed attempt marks that pair as done for the candle (with a short cooldown) instead of resetting the counters. One attempt per pair per candle.
- **Hard slippage cap:** compute a max acceptable price from the price the signal was scored at (scored quote + 2¢, never more). If the fresh quote has moved past that, skip the trade and log "quote moved — skipped" rather than chasing it.
- **Re-check edge before sending:** re-run the EV/confidence check against the fresh quote at order time; if the edge is gone at the new price, don't send.
- **Correct fill-price units:** normalize `average_fill_price` (dollars vs cents) and log the actual average fill as `entry_price`, so stake, P&L and the dashboard match reality.
- **Depth-aware sizing:** size the order to the volume actually resting within the slippage cap instead of blindly capping to top-of-book, so thin books get a smaller order rather than a cancel-then-retry loop.
- **Clearer failure reasons** in the log: "book too thin", "quote moved", "edge gone at fill price" instead of one generic message.

## Not changing

Signal math and thresholds, gate timing (10:00 mark), bet size, 2–4 trade toggle, daily loss cap, the 7 pairs, the server bot, and the settlement/tape pipeline. LIVE MONEY stays as it is.

## Technical notes

- `src/lib/kalshi.server.ts` → `placeLiveOrder`: single attempt with a caller-supplied `maxPriceCents`, fill-price normalization, depth-aware count, distinct error codes.
- `src/lib/kalshi.functions.ts`: pass `scoredPriceCents` / `maxPriceCents` through the validator.
- `src/hooks/useBot.ts` → `fire`: remove the counter rollback on failure, add per-pair cooldown, pass the scored price, store the normalized fill price.
- `src/lib/bot/server-engine.server.ts`: same call-site change so the server bot inherits the slippage cap.
