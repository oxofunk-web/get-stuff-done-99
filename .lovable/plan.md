# Keep pair-edge logic, shrink the panel

The pair-edge system stays in the engine — it's doing real work: per-pair calibration feeds the EV gate, edge ranking picks the best pairs per candle, and the cooldown is currently what's stopping BTC (‑$13.17) and ETH (‑$13.35) from bleeding further. What changes is only how much dashboard space it takes.

## What changes

1. **Engine: untouched**
   - Per-pair calibration, edge ranking, cooldown/probe logic all stay exactly as they are. No threshold, gate, sizing, or order changes.

2. **PAIR EDGE panel becomes compact**
   - Replace the current five-column grid with one tight line per pair:
     `SOL  risk $4.90 · needs 77% · actual 63% n8 · +$9.44` with the same color coding (green edge, red edge, gold learning, red PAUSED badge).
   - The long explanatory footer shrinks to a single short line.
   - All the same numbers stay visible — risk/trade, breakeven, actual win rate, sample count, P&L — just denser and phone-friendly.

## Technical notes

- Edit only `src/components/bot/PairEdgePanel.tsx` (render/markup); no changes to `calibration.ts`, `ranking.ts`, `signals.ts`, telemetry, or the server engine.
- Typecheck + Vitest must pass; quick Playwright check that the panel renders and no console errors.

## Not touched

Signal math, 86% threshold, EV margin, sigma filter, 10:00 gate, $5 sizing, 2/3/4 trade cap, daily loss cap, slippage cap, order placement, LIVE MONEY state, server bot, tape recording.
