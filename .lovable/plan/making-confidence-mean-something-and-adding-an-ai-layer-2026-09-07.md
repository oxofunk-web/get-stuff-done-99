# Making confidence mean something, and adding an AI layer

I read the whole engine and then checked what the recorded data actually says. Two findings change the priorities.

## What the data shows

- Signals that fired and later settled: 262 graded, 151 wins — **57.6% win rate at an average entry price of 72¢**. Breakeven at 72¢ needs ~72%. So the trades that pass every gate today lose money on average.
- Win rate by confidence band: 75s won 60%, 80s won 54%, 85s won 60%. **The confidence number does not predict anything right now.** Raising or lowering the threshold cannot fix that — it just changes how many coin flips get taken.
- Every rejected signal is stored with its confidence, price and edge fields **empty**, so there is no way to measure whether the score separates winners from losers, and rejected reads teach the bot nothing.
- The bot is currently stuck: real orders are blocked until 50 settled real fills exist ("shadow only — real-fill probability is not proven yet"), and only 14 real fills exist. It can never collect the evidence it is waiting for.
- Biggest single blocker is "mid outside tradable band" (21.8k rejections in 2 days) — mostly contracts priced above 94¢ or below 8¢, which is expected and fine.

## 1. Measure before tuning

- Write the full feature row on **every** decision, fired or rejected: confidence, both raw and displayed, entry price, edge, skew, cushion in sigma, both momentum readings, spread, depth, minute-in-candle.
- New dashboard block: win rate per confidence band for fired *and* rejected reads side by side, so it's visible at a glance whether a higher score actually wins more often. If the two lines are flat, the score is noise and the threshold is meaningless.

## 2. Break the learning deadlock

- Bootstrap mode: while real fills are under 50, allow real orders at a minimum stake ($1-2, dashboard-controlled) instead of blocking them entirely, and only on the cheapest legs (entry under 55¢) where a loss is small and the price itself carries edge. That gathers honest evidence at a known, capped cost.
- Hard cap on total bootstrap risk per day, separate from the normal loss cap.

## 3. Make confidence a real probability

- Replace the hand-weighted score with a fitted model over the recorded features (logistic regression, trained offline on settled rows from the tape, refit as data arrives). It outputs a probability directly, so the EV gate stops relying on a hand number.
- Keep the current score as a fallback and as a display until the fitted model beats it on held-out candles.
- Enforce the price ceiling always: with the measured 57.6% hit rate, a 72¢ entry can never be right. Drop the entry cap to ~0.60 until a proven probability justifies more.
- Once the model exists, the threshold becomes what it should be: "probability minus price must exceed the margin", not a magic number on a dial.

## 4. Adding AI

Two places where AI genuinely helps, and one where it does not.

- **Per-candle market brief (helps).** Once per candle, per pair, an AI call summarizes the regime from the recorded tape and recent price action: trending or chopping, volatility expanding or collapsing, whether the book is disagreeing with spot. It returns a structured judgement (regime label, confidence multiplier within a narrow band, plain-English note) that nudges sizing and appears on the dashboard so the reasoning is readable. Cached per candle, never in the per-tick path.
- **Nightly coach (helps most).** An AI pass reads the last day of decisions and outcomes and reports in plain English which gate cost money, which pair to stop trading, and which setting to change — with the numbers behind each claim. Recommendations are proposals; nothing self-applies.
- **Not the trade decision.** A language model cannot price a 15-minute binary better than a fitted model on your own tape, and a 2-4 second decision window cannot wait for one. AI advises and explains; the math decides.

## 5. Order of work

1. Full feature logging on every decision + the discrimination panel (read-only, no behaviour change).
2. Entry cap to 0.60 and bootstrap small-stake mode, so real evidence starts accumulating safely.
3. Nightly AI coach (needs only existing data).
4. Per-candle AI brief.
5. Fitted probability model, once ~200 settled rows with full features exist, promoted only if it beats the current score out of sample.

## Technical notes

- Feature logging extends `signal_log` (new columns, nullable) and the `note()` payload in `src/lib/bot/signals.ts`; the trace already carries the values, they are just dropped before insert.
- Bootstrap mode adds `bootstrap_stake` / `bootstrap_max_daily` to `bot_settings` and a branch in `server-engine.server.ts` where the "shadow only" skip is raised today.
- AI calls go through Lovable AI in server functions (`src/lib/bot/coach.functions.ts`, `src/lib/bot/regime.functions.ts`) with structured output; results cached in a small `ai_notes` table so a failed or rate-limited call never blocks a tick.
- The fitted model ships as coefficients in `src/lib/bot/model.ts` produced by an offline script in `scripts/`, so the live path stays pure arithmetic and testable.
- New migrations include grants and RLS as usual; live trading stays under the existing single ON/OFF switch and loss cap.
