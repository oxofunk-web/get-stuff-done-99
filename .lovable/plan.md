# Why no trades are showing — and what to fix

Short answer: the PAIR EDGE panel is not the cause. It only displays numbers. Two other things are stopping you.

## What the live data shows

- Signals are still being generated. The most recent fired signal was BTC YES at 68c a few minutes ago, and before that BTC, SOL, ETH and DOGE all fired within the last hour.
- Realized live P&L today is **-$20.69**, which is past your **$20 daily loss cap**. The client bot's cap logic stops auto-trading for the rest of the day once that trips, which is exactly the state it is in now.
- Of 147 live attempts today, 119 failed before reaching the exchange: no resting volume, book too thin, or the quote moved past the slippage cap. Only 28 actually filled.
- The server runner is live and ticking every minute, but its last messages are "outside the trade window" and "in window, no signal passed the gates" — and it has **no daily loss cap of its own**, so it is not the thing that stopped.
- Right now most pairs are rejecting with "mid outside tradable band" (price sitting outside the 12c-90c band) and BNB with "not enough live data yet", which are normal mid-candle rejections, not a bug.

## What to change

1. **Make the loss-cap stop visible.** Today it silently freezes trading. Add a clear banner on the dashboard: "DAY STOPPED — loss cap -$20 reached, resets at midnight UTC", plus a one-tap "Reset day" button so you can resume deliberately instead of wondering why nothing fires.
2. **Show today's P&L against the cap** next to the cap buttons (e.g. "-$20.69 / -$20"), so the freeze is never a surprise.
3. **Apply the same loss cap to the server runner.** It currently ignores it, which means the two halves of the bot disagree about whether trading is allowed.
4. **Show why each pair is idle in the signals area.** Surface the live rejection reason per pair (out of band, book too wide, warming up, paused) so "no signals" reads as "here is what each pair is waiting for".
5. **Reduce wasted attempts.** 119 of 147 attempts died on thin books. Require a minimum resting size at the price before sending, and skip instead of logging a failure, so the log reflects real opportunities rather than noise.

## Not changed

Signal math and the 86% confidence threshold, the EV gate, sigma distance, timing/gate seconds, $5 stake, 2/3/4 trades per candle, one trade per pair, order placement mechanics, slippage cap, pair calibration, and tape recording all stay exactly as they are.

## Technical notes

- `src/hooks/useBot.ts`: expose `dayPnl` and `capHit` to the UI, add a manual day reset, keep the cap check as-is otherwise.
- `src/components/bot/Dashboard.tsx` / `EnginePanel.tsx`: stopped banner, day P&L versus cap, per-pair idle reasons.
- `src/lib/bot/server-engine.server.ts`: read today's settled live P&L before selecting, and skip the tick when the cap is exceeded; enforce minimum resting depth before order submission.
- `src/lib/bot/order-map.ts` / `kalshi.server.ts`: shared minimum-depth check used by both client and server paths.
