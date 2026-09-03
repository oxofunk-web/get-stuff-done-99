# Resume BTC/ETH, run the server bot live, widen slippage, sharpen ranking

Four changes. Signal gates (86% confidence, EV margin, sigma distance, spread/skew/band filters), the 10:00 trade window, the $5 stake, the 2/3/4 per-candle cap, the daily loss cap and the tape recording all stay exactly as they are.

## 1. Resume BTC and ETH

The hard veto currently pauses any pair with 5+ settled trades and negative P&L. BTC (7 settled, -$13.17) and ETH (6, -$13.35) are both paused by it.

Replace the permanent veto with a cooldown:
- A losing pair is paused for a limited number of candles instead of forever.
- Manual resume: clear the pause for BTC and ETH now so they trade again immediately.
- The PAIR EDGE panel keeps showing PAUSED, plus how long the pause lasts.

## 2. Server bot LIVE at $5

`bot_settings` is currently `mode = paper`, `bet_size = 5`, `max_trades = 4`, enabled. Flip `mode` to `live` so the cron ticks place real Kalshi orders while your phone is asleep. Bet size, per-candle cap and loss cap are unchanged; the client bot on your phone keeps working the same way, and the per-candle idempotency keeps client and server from doubling up on a pair.

## 3. Slippage cap 2c -> 3c

`MAX_SLIPPAGE_CENTS` goes from 2 to 3, in one place, so both the client and the server order paths pick it up. Fewer "quote moved" skips (last hour: BTC skipped at 62c vs a 61c cap), at a cost of at most 1c more per contract. Depth checks and the single-shot IOC behaviour stay as-is.

## 4. Rerank: reward real win rate, punish high breakeven

Ranking today is `EV per dollar + 0.5 x measured edge`, where edge is actual fired win rate minus average entry price. Two adjustments:
- Weight measured edge higher than raw EV once a pair has real settled history, so a pair with a strong record outranks a marginally higher-EV signal on an unproven pair.
- Add an explicit penalty for expensive entries: a pair whose average fill sits near the top of the book needs a very high win rate to break even, so high-breakeven pairs are pushed down the ranking.
- Keep the thin-sample shrink so a pair with 1-2 trades cannot dominate.

Selection order stays: gates -> drop paused pairs -> rank best-first -> one trade per pair -> stop at your 2/3/4 cap.

## Technical notes

- `src/lib/bot/ranking.ts`: cooldown-based `pairVetoed`/`dropVetoed`, plus revised `rankScore` (edge weight scaled by sample size, breakeven penalty term). Add unit tests for the ranking order and cooldown expiry.
- `src/lib/bot/constants.ts`: `MAX_SLIPPAGE_CENTS = 3`.
- `bot_settings` row updated to `mode = 'live'` (data change, not schema).
- `src/components/bot/PairEdgePanel.tsx`: PAUSED badge shows remaining cooldown; footer text updated to describe the new ranking.
- Verify with typecheck, the existing Vitest suite, a recorded-tape backtest to confirm ranking still ranks sanely, and a live check of the next few server ticks.
