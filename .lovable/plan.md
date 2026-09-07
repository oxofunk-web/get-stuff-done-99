# Full engine reset + fix the disappearing signals

## What I found (checked live, just now)

The engine is not broken or asleep. It ticked seconds ago and is scoring every pair:

- BTC scored 57.2, DOGE 60.9 — both just under your 66 confidence dial, so both were rejected as "missed by 8.8 / 5.1".
- ETH, SOL, XRP were rejected as "mid outside tradable band"; BNB/NEAR sometimes "nothing resting in the book".
- Bot switch is OFF and mode is paper, so nothing would be ordered anyway.

That is exactly why signals appear and then vanish a minute later: scores drift a few points around your dial, so the same pair crosses 66 and falls back under it. Nothing is resetting on refresh.

Second, real problem: the Signals panel on your phone is fed by the **phone's own** price feed, not the server bot. On mobile most pairs never collect enough ticks, so the panel says "not enough live data yet" for 6 of 7 pairs while the server is happily scoring all of them. So the screen genuinely does not show what the bot thinks.

## The reset you asked for

1. Wipe all bot history: past trade attempts and fills (103 rows, 14 placed), the full decision log, and the recorded price tape. Learning starts from zero.
2. Clear pair pauses/cooldowns and any leftover day-loss baseline, so all seven pairs are eligible immediately.
3. Clear the stale run lease so the next scheduled tick takes a clean lock.
4. Leave your dials as they are (66 dial, 5:00 window, $10, 2 trades/candle, $20 cap) and leave the bot switch OFF and paper mode — your call to flip it on.

Your real Kalshi account, wallet and any open positions are untouched — only the bot's own records.

## The UI fix (so this stops being confusing)

5. The Signals panel and the "why each pair is idle" strip read from the **server** decisions instead of the phone's feed, with the pair's real reason and score (e.g. "57.2 — missed by 8.8"). No more false "not enough live data yet".
6. Show the last server tick time in the header, so a stale screen is obvious at a glance.
7. Show near-misses: any pair within a few points of your dial is listed as "close" with its score, so you can see it building instead of it silently blinking in and out.

## Technical notes

- Deletes: `trade_log`, `signal_log`, `market_snapshots`; `bot_settings.run_lease_id/run_lease_until` nulled; `MANUAL_RESUME` in `src/lib/bot/ranking.ts` emptied (already empty — verified).
- `SignalsPanel` / `Dashboard` consume the existing server tick payload (`bot.server`) as the source for pair verdicts and near-misses; client-engine reasons are dropped from display only.
- No change to signal math, gates, thresholds, order placement or settlement. Live trading stays off.
- Verify with a typecheck plus the existing bot test suite, then watch one candle in the preview.
