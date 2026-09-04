# Why you see no signals and no trades

Nothing is broken in the plumbing. I pulled the live rows just now:

- The runner is alive and inside the trade window: last heartbeat 06:10 UTC, `in window · no signal passed the gates · 8 looks`, 8 sampling rounds per tick.
- Live trading is ON: $10 per bet, 3 per candle, $20 daily cap.
- The book data is real and fresh (BTC ticker `KXBTC15M-26SEP040215-15`, 87/88¢ quotes seconds old).
- Every pair is being killed by a **filter**, not by a bug. The newest server rounds read: `not enough value at this price` (EV gate), `mid outside tradable band`, `book too flat`, `book too wide`, `spot too close to the strike`, `confidence below threshold`.
- The dashboard is rejecting for the same reasons at the same second, so client and server agree.

So the engine is looking 8+ times per candle and the filter stack is currently strict enough that essentially nothing can pass — that is why it "was better before": the gates were looser then.

## The gates that are actually blocking you

| Gate | Now | Effect seen in the log |
| --- | --- | --- |
| Confidence | 86 | `confidence below threshold` |
| EV per dollar | 0.08 | `not enough value at this price` — most common rejection |
| YES mid band | 12–90¢ | `mid outside tradable band` on 87¢ books (the ones with real depth) |
| Book skew | 4¢ | `book too flat` |
| Max spread | 5¢ | `book too wide` (NEAR every round) |
| Strike cushion | 0.55σ | `spot too close to the strike` |

## What I'll change

1. **Loosen the stack to a tradable setting**: confidence 78, EV margin 0.04, mid band 8–94¢, skew 2¢, max spread 7¢, cushion 0.35σ. These are the values that let a well-priced 85¢ favourite through instead of discarding it.
2. **Put all six on the dashboard** in a new `SIGNAL GATES` block in Bot Control, with a preset switch: **STRICT** (today's values), **BALANCED** (the new defaults), **AGGRESSIVE** (confidence 70, EV 0.02, mid 5–97¢, skew 1¢, spread 9¢, cushion 0.2σ). Saved in `bot_settings` so the server runner uses exactly what you pick.
3. **Show the blocking gate live** on the dashboard: per pair, the newest rejection reason and how far it missed by, so you can see "ETH missed EV by 0.01" instead of silence.
4. **Nothing else changes**: the 10:00 window, one trade per pair per candle, depth check, 3¢ slippage cap, balance check, daily loss cap, and order mechanics stay as they are.

## After the change

Publish (only the deployed build runs the scheduled tick), then watch one window. If orders still don't go out, the skip reason per pair will name the exact gate rather than a guess.

## Technical notes

- `bot_settings`: add `threshold`, `ev_margin` (exists), `min_yes_mid`, `max_yes_mid`, `min_skew`, `max_spread`, `min_sigma_dist`, `gate_preset`, with GRANTs matching the existing table.
- `src/lib/bot/constants.ts`: relax the BALANCED defaults; `tuning.ts` unchanged in shape.
- `src/lib/bot/server-engine.server.ts`: pass the full saved gate set into `setTuning` (currently only `evMargin`).
- `src/lib/bot/serverbot.functions.ts`: extend the zod patch schema with the gate fields plus preset.
- `src/hooks/useBot.ts` + `EnginePanel.tsx`: preset buttons and sliders; `SignalsPanel.tsx`/`ServerBotPanel.tsx` surface the newest blocking gate per pair from `signal_log`.
