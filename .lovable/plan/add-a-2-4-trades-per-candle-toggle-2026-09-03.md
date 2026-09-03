# Add a 2–4 trades-per-candle toggle

Let you choose how many signals the bot may fire per 15-minute candle: 2, 3, or 4 (still one per pair, best signals first). Nothing else changes — gates, thresholds, sizing, loss cap, and order code stay as-is.

## What changes

- `useBot.ts`: add a `maxTrades` state (default 4, today's value) with a setter. The auto-trade effect and the per-candle lock compare against this setting instead of the fixed `MAX_TRADES_PER_CANDLE` constant.
- `EnginePanel.tsx`: add a small "MAX TRADES / CANDLE" row of three buttons (2 / 3 / 4), styled exactly like the bet-size buttons above it. Gate text shows the selected number.
- `Dashboard.tsx`: pass the new value and setter through to the engine panel.

## What stays the same

- One trade per pair per candle, 86% threshold, EV/skew/spread filters, 10:00–14:00 window, $5/$10/$15/$25 sizes, daily loss cap, live/paper behavior — all untouched.
- Server bot and recorded-tape logic unchanged.

## Technical notes

Files touched: `src/hooks/useBot.ts`, `src/components/bot/EnginePanel.tsx`, `src/components/bot/Dashboard.tsx`. `MAX_TRADES_PER_CANDLE` stays in constants as the default; the toggle only changes the client-side cap for the current session.
