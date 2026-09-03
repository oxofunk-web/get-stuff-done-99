# Publish the app + fix what the live data says is costing you money

## What your real trade data shows

Settled live trades (28 total):

| Pair | Trades | Win rate | P&L |
|------|--------|----------|-----|
| SOL  | 8 | 87.5% | +$9.44 |
| XRP  | 5 | 80.0% | +$8.15 |
| DOGE | 2 | 50.0% | −$7.99 |
| BTC  | 7 | 57.1% | −$13.17 |
| ETH  | 6 | 66.7% | −$13.35 |

And 119 of 149 order attempts (80%) **failed to execute**:
- 69× "No resting volume at the live price" — book too thin at the limit price
- 48× "Insufficient Kalshi balance" — bot kept firing while wallet was empty
- 2× quote moved / thin book

## Plan

### 1. Publish the app
Publish so the server bot runs from a stable production URL and keeps trading in the background (no browser needed). Your key is already verified server-side.

### 2. Stop the 48 wasted "insufficient balance" attempts
Before firing any trade, check live wallet balance. If balance < stake, pause new entries and log "waiting for funds" instead of spamming failed orders. Applies to both client and server bot.

### 3. Cut the 69 "no resting volume" failures
Check resting depth at the target price *before* sending the order (we already fetch the book for signals — reuse it). If depth can't cover the contract count, either shrink the order to available size or skip the signal. No change to signal logic.

### 4. Auto-pause losing pairs (hard veto, not just ranking)
The Pair Edge panel already measures real win rate per pair. Extend it into a gate: once a pair has ≥5 settled trades **and** negative P&L, the bot stops firing that pair until its measured edge recovers (graded near-misses keep recording so it can re-qualify). Today that would pause BTC, ETH, DOGE and concentrate on SOL/XRP — the two pairs actually making you money.

### 5. Show it on the dashboard
Pair Edge panel gains a "PAUSED" badge on vetoed pairs so you can see exactly why a pair isn't trading.

## What does NOT change
Signal math, 86% confidence threshold, EV gate, 10:00 gate timing, $5 sizing, 2/3/4 trade cap toggle, daily loss cap, order placement mechanics, tape recording.

## Technical notes
- Balance check + depth check reuse existing `getBalance` / orderbook server functions.
- Pair veto lives in `src/lib/bot/ranking.ts` (shared by client `useBot.ts` and server engine) using the existing per-pair settled outcomes from telemetry.
- Publishing happens first so the server bot URL stabilizes before the new logic ships.
