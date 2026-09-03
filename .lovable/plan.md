# Learn from my own settled trades, per pair

Right now the bot's probability comes from one global confidence table: every pair shares the same win-rate curve. Your settled history says the pairs are not the same — settled fired signals so far: SOL 58/77, XRP 41/43, BTC 28/35, ETH 13/20, DOGE 10/12. The plan makes the bot weight each pair by its own measured record, and puts the dollar risk and implied win rate for each pair on the dashboard.

## What changes

1. **Per-pair calibration**
   - The settled history is grouped by pair *and* confidence band (fired trades plus the counterfactual-graded rejections already being logged).
   - A pair's own win rate is blended toward the global curve using a sample-weighted shrink: with few settled samples a pair behaves as it does today; as its record grows, its own number takes over. No pair can swing the probability on 2-3 trades.
   - The blended number becomes the `calibrated` probability that already feeds the EV gate, so a pair you lose on needs a better price to clear the same EV margin, and a pair you win on clears more often. No threshold, gate, sizing, loss-cap, or order code changes.

2. **Same table on the server bot**
   - The server runner loads the identical per-pair table each tick, so background trades use the same learned probabilities as the client.

3. **New "PAIR EDGE" panel on the dashboard**
   For every one of the seven pairs:
   - **Risk / trade** — dollars actually at stake at the current bet size (contracts x entry price, i.e. what you lose if it settles wrong).
   - **Implied win rate** — the market's breakeven from average entry price (e.g. 78c => needs 78%).
   - **Actual win rate** — your settled win rate, with sample count so thin pairs are visibly thin.
   - **Edge** — actual minus breakeven; green when the pair is genuinely profitable, red when it is not.
   - **Realized P&L** for the pair.
   - Pairs with too little history are labelled "learning" rather than shown as good or bad.

## Technical notes

- `src/lib/bot/calibration.ts`: add a pair-keyed table type and a `calibrateFor(pair, conf, table)` that shrinks pair stats toward the global bucket; keep the existing `calibrate` behaviour as the fallback.
- `src/lib/bot/telemetry.functions.ts`: extend `getAccuracy` with a per-pair band breakdown plus per-pair avg entry, settled n/wins, and realized P&L from `trade_log`; keep existing fields so nothing else breaks.
- `src/lib/bot/signals.ts`: pass the pair into calibration; unchanged filter/gate math.
- `src/lib/bot/server-engine.server.ts`: load the extended table.
- New `src/components/bot/PairEdgePanel.tsx`, rendered in `Dashboard.tsx`; uses existing theme tokens.
- Unit tests for the shrinkage (thin pair ≈ global, heavy pair ≈ own rate); typecheck + existing Vitest suite must pass.

## Not touched

Confidence threshold (86%), EV margin, sigma-distance filter, 10:00 gate, $5 sizing, max-trades toggle, daily loss cap, order placement, LIVE MONEY state, and tape recording all stay exactly as they are.
