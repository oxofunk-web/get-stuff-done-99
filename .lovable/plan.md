# Unify the bot: one trader, one dashboard

## Problem
Today there are two trading engines:

1. **Auto-Trade Engine** (runs inside the phone/browser tab) — stops when the screen locks or the tab sleeps.
2. **Server bot** (runs from the scheduled tick every minute, works while the phone sleeps).

Each keeps its own per-candle trade count (server counts only `source="server"` rows; the phone counts in memory). When both are on, the same candle can get up to **double** the intended number of trades. That's why it feels crazy — you effectively have two bots with separate brains and separate caps.

## Answer
You do **not** need both. The server bot alone does everything the phone engine does (same signals, same gates, same ranking), plus it keeps running while your phone sleeps. The plan makes the server bot the single trader.

## Changes

### 1. Server bot = the only trader
- The server bot stays exactly as-is: live at $5, 4 trades/candle, $20 daily loss cap, 3¢ slippage, edge ranking, cooldowns. No signal, gate, sizing, or order logic changes.

### 2. Dashboard becomes control + monitor (no order placement)
- Remove the client-side order-firing loop from `useBot.ts`. The phone app no longer places trades, so a sleeping phone can't lose trades and an open phone can't double them.
- Keep everything you look at: BRTI prices, signals panel (with per-pair idle reasons), wallet balance, real P&L, positions, PAIR EDGE, day-stopped banner, and the server-bot heartbeat/recent-trades panel.
- Keep the controls, but have them write to the shared `bot_settings` row the server bot reads, so the phone becomes the remote control for the server bot:
  - **BOT STATUS** on/off → `enabled`
  - **LIVE MONEY** arm → live confirm (unchanged safety)
  - **Bet size** ($5/$10/$15/$25) → `bet_size`
  - **Max trades** (2/3/4) → `max_trades`
  - **Daily loss cap** → `daily_loss_cap`
  - **RESET DAY** → unchanged (client banner + server reads today's settled P&L anyway)

### 3. Per-candle cap becomes truly shared
- Server per-candle check counts **all** `trade_log` rows for the candle (not just `source="server"`), so nothing can ever exceed the cap regardless of who placed it.

## What does NOT change
- Signal math, thresholds, timing gates, EV/slippage rules, edge ranking, cooldowns, tape recording, settlement cron, order placement mechanics.
- The server bot's current live settings ($5 / 4 trades / $20 cap).

## Verification
- Typecheck + the 14 Vitest tests pass.
- Headless dashboard check: controls write through to settings, signals/P&L still render, no console errors.
- Republish so the published server bot picks up the shared-cap counting.
