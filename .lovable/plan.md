# Good signals on screen, no trades placed — what's actually happening

## What the live data shows

- `trade_log` is completely empty since the reset — not even failed attempts. So the server never reached the order step.
- The server's last heartbeat says **"in window · no signal passed the gates"** at 04:12 UTC.
- Yet `signal_log` has fired rows in the same candle: ETH YES at 88c (conf 97) at 795s, BTC YES at 56c (conf 93) at 780s.
- Those fired rows are written by the **dashboard in your phone**, not by the server. The dashboard still computes and logs signals every second; it no longer places orders. The server is the only trader now, and it evaluates the gates **once per minute**, from its own 4-sample burst.
- Many server rows read "not enough live data yet" (DOGE, NEAR, BNB) — the momentum math needs ~24 ticks in the candle, and 4 samples/minute is too thin when your phone isn't also feeding the tape.
- Exchange depth is fine (ETH 285 resting at ask, BTC 894, DOGE 114), so depth is not what's blocking it.

So: the signals you see are real, but they are the dashboard's second-by-second view. The server looks maybe 4 times inside the 10:00-14:00 window, usually at a moment when the momentary 86% gate isn't satisfied, and with a thinner tick history — so it fires nothing and places nothing.

## What to change

1. **Make the server evaluate continuously inside the trade window, not once a minute.** Each tick that lands in the window keeps sampling and re-scoring every few seconds until it either fills its trade cap or the window closes. That gives the server the same many-chances-per-candle view the dashboard has.
2. **Sample denser all candle long** so the tick history is warm before the window opens, ending the "not enough live data yet" rejections when the app is closed.
3. **Log every skip.** Right now a signal dropped for no ticker, thin depth, or a cooldown leaves no trace at all — that is why "good signals but nothing placed" is invisible. Record these as skipped rows with a reason and surface the newest one on the dashboard.
4. **Label the signal source.** Mark logged decisions as dashboard vs server so the panel can show "server saw" next to "you saw" and the two never look contradictory again.

## Not changed

Signal math and the 86% confidence gate, EV gate, sigma distance, the 10:00 window and 14:00 close, $5 stake, 3 trades/candle, one trade per pair, 3c slippage cap, edge ranking, cooldowns, daily $20 loss cap, and order mechanics all stay exactly as they are.

## Technical notes

- `src/lib/bot/server-engine.server.ts`: restructure the tick into sample -> score -> (in window) trade, looped on a short interval until the tick's time budget or `CLOSE_SECS` is reached; raise `SAMPLES`/shorten `SAMPLE_GAP_MS` so each tick contributes more ticks to the tape; write a `skipped` verdict row (no ticker / depth below `MIN_RESTING_DEPTH` / cooldown) instead of a bare `continue`.
- `src/lib/bot/serverbot.functions.ts` + `ServerBotPanel.tsx` / `SignalsPanel.tsx`: expose and display the latest server skip reasons per pair.
- `src/lib/bot/telemetry.functions.ts`: add a source tag on signal rows so dashboard and server decisions are distinguishable.
- Cron stays at one minute; the longer in-window tick is bounded so ticks never overlap dangerously.
