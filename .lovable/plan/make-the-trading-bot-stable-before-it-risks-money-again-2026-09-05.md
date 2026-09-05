# Make the trading bot stable before it risks money again

## What the live evidence says

- The bot is currently **OFF**. Keep it OFF throughout repair and validation.
- There are only **14 settled real fills**: 9 wins, 5 losses, **+$6.89 on $128.11 risked**. That is a 64.3% win rate and 5.4% return, but far too small a sample to call the strategy stable.
- The recent pain is concentrated: **SOL is -$23 across 4 fills** and ETH is -$10.50 on 1 fill. BTC is +$29.29, but only across 4 fills, so that is also not enough evidence to trust.
- The displayed/calculated confidence is overstated. Real losing fills averaged **84.8% claimed probability**, and the latest SOL loss was labeled **99%**. The calibration currently learns from rejected hypothetical signals as well as actual fills, so its probability and EV claims are not reliable.
- Execution is also unstable: the history contains **89 failed attempts vs. 14 fills**. Most failures are vanished depth or a moving quote.
- The newest SOL and NEAR outcomes match the exchange’s finalized results, so those two losses/wins were genuine—not merely reversed labels.

## Changes

### 1. Stop treating a score as a probability
- Split reporting into three unmistakable groups: **real filled trades**, **shadow signals**, and **rejected opportunities**.
- Build live calibration and pair ranking from settled real fills only. Never let rejected or browser-monitor rows influence money decisions.
- Replace raw win-rate boosting with conservative uncertainty bounds. Until a pair has enough independent fills, mark its edge **unproven** and do not inflate confidence to 99%.
- Remove “expected value” claims from live decisions when the probability estimate lacks enough real samples.

### 2. Eliminate correlated and duplicate evidence
- Allow one calibration observation per pair per candle, even if direction flips during that candle.
- Raise the pair-ranking and pause/resume sample requirements; do not reward or ban a pair based on 5–20 noisy outcomes.
- Track strategy/configuration version with each signal and fill so results from different settings are never blended.

### 3. Make settlement authoritative
- Settle each filled trade from the exchange’s finalized contract result using its exact ticker, instead of estimating the result from the last locally recorded spot.
- Preserve floor-versus-cap contract type and apply the correct direction rule; reject any unsupported contract shape rather than guessing.
- Use local tape settlement only for explicitly labeled shadow analysis, with a maximum sample-age check.

### 4. Tighten the order path
- Fetch the exact ticker again immediately before submission, after the balance check, and require fresh price, direction, strike, spread, and resting depth to still pass.
- Count open stake at worst-case loss toward the daily loss cap so delayed settlement cannot allow excess risk.
- Use one order attempt per pair per candle; an IOC miss becomes a skip, not another chase.
- Record quote age, requested size, visible depth, actual fill size, and final price for every attempt.

### 5. Replace optimistic testing with realistic testing
- Make tape replay honor actual depth, missing books, partial/no fills, quote age, order delay, slippage cap, stable-sample confirmation, pair limits, and the daily risk cap.
- Add chronological train/validation splits. A setting may be proposed only from earlier data and must pass later unseen candles.
- Add regression tests for exchange-result settlement, cap/floor contracts, stale closes, direction flips, unproven calibration, open-risk loss caps, and quote/depth changes before submission.

### 6. Safe restart protocol
- Reset only contaminated signal/calibration data; preserve the real trade and order audit history.
- Restore **$5 stake, maximum 1 trade per candle, strict gates, live OFF**.
- Run shadow-only for at least **100 independent settled candidate candles** and report fill-adjusted return, drawdown, per-pair results, and confidence intervals—not just win rate.
- Do not enable real trading automatically. Present the validation report first; live trading requires a separate explicit approval.

## Verification

- Typecheck and run the complete bot test suite.
- Replay old tape through both old and new logic and show exactly which historical bad fills the new rules would block.
- Verify exchange-finalized outcomes against stored settlements for every trade with a ticker.
- Observe at least one complete trade window with the bot OFF and confirm stable sampling, one decision per pair/candle, accurate reasons, and no order attempts.

## Important limitation

No change can guarantee profitable trades. This plan makes the bot auditable, conservative, and statistically honest; it prevents the current false-confidence and execution failures before any more real money is exposed.
