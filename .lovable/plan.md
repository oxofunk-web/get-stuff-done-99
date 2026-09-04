# Clean slate + live-only autonomous bot

Full reset of all recorded data and settings, removal of paper mode entirely, and one simple LIVE TRADING switch that arms real orders instantly. Then verify the server runner actually places trades on its own.

## 1. Reset everything

- Clear all trade history, signal history, and the recorded market tape.
- Reset the bot's saved settings to defaults: bot OFF, $5 per trade, -$20 daily cap, 4 trades per candle, current value gate.
- Clear the warmup/confirmation stamps so nothing carries over from the old run.
- The bot stays OFF after the reset — nothing trades until you flip the switch.

## 2. Remove paper mode

- Delete the PAPER / LIVE MONEY pair of buttons and every paper code path in the engine.
- One control remains: **LIVE TRADING — ON / OFF**. On means real money orders immediately, no warmup period, no delayed arming.
- The switch shows a clear red state and a plain-language warning line when it is on.
- Every place that used to say "paper" (header, runner panel, trade list, P&L, markets) now reads live-only.
- The simulated-fill code is removed, so a signal either becomes a real order or a recorded reason why not.

## 3. Keep risk controls in your hands

Dashboard still owns: bet size ($5/$10/$15/$25), max trades per candle (2/3/4), minimum value per $1 risked, daily loss cap, and the day reset. Defaults after reset are $5 / 4 / -$20 and you adjust from Bot Control.

Unchanged safety: one trade per pair per candle, orderbook depth check, slippage limit on entry, wallet balance check before ordering, hard stop at the daily loss cap, and the fresh-quote recheck immediately before submitting.

## 4. Verify it trades by itself

- Run the scheduled runner endpoint repeatedly against the live feeds and confirm: one run at a time, fresh spot and orderbook, and every candidate ending in one explicit outcome (order placed, quote moved, thin book, cap reached, no open market, balance too low, or rejected by the exchange).
- Confirm the switch state written from the dashboard is what the runner reads.
- Watch a full trade window (the 10:00 mark through close) with live trading on and report exactly what happened: signals scored, orders attempted, fills, and each rejection reason.
- Run the test suite and type checks.
- Publish, since only the published build is what the every-minute schedule executes.

## 5. Exit management (included)

Today an entry is fire-and-forget until the candle settles, so a winning position can give everything back before close. Adding managed exits:

- After a fill, the runner keeps watching that position every tick until the candle closes.
- **Take profit:** if the contract's bid rises far enough above the entry price, sell into the move and bank the gain.
- **Stop out:** if the bid falls far enough below entry, or the signal's direction has clearly flipped, exit early rather than riding it to zero.
- **Let it settle:** if neither trigger hits, the position rides to settlement as it does now.
- Exits use the same protections as entries: fresh quote, depth check, slippage limit, immediate-or-cancel order.
- Both thresholds are adjustable from Bot Control, and each exit is recorded with its trigger and realized P&L so the tape shows whether exits helped.

Other ideas (per-pair auto-throttle, time-of-day filter, alerts, runner watchdog) are noted but out of scope for now.


## Technical notes

- Data reset via a migration/data change over `trade_log`, `signal_log`, `market_snapshots`, and a settings reset on `bot_settings` (id = true), including clearing `live_confirmed_at`, `first_enabled_at`, and any run lease.
- `mode` column stays in the schema for compatibility but is pinned to `live`; `effectiveMode`, `warmupMsLeft`, `PAPER_WARMUP`, `confirmServerLive`, and `placePaperOrder` are removed from `serverbot.functions.ts`, `server-engine.server.ts`, and `order-map.ts`.
- `useBot.switchMode` and the mode buttons in `EnginePanel.tsx` are replaced by a single `liveEnabled` toggle bound to `bot_settings.enabled`.
- Verification exercises `/api/public/bot-tick` with the cron token; tests via `bunx vitest run`, types via `bunx tsgo --noEmit`.
- Trading logic stays out of presentation components; confidence and risk thresholds are not loosened as part of this work.
