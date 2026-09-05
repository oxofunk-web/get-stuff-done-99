# Stabilize the live signal engine

The bot is currently **OFF**, which is the safe state while this is repaired.

## What is actually happening

- The latest saved settings are a custom, unusually loose profile: **64% threshold**, **$15 stake**, and **3 trades**, not the Balanced defaults.
- A single 15-minute period is recording **two different market tickers per pair**. Their prices are being combined into one history, which can create artificial book momentum and a wrong direction.
- Production calibration reads repeated 5-second rows as independent evidence. The database has **107,689 rows but only 2,705 distinct decisions**, so repeated observations can inflate probabilities as high as 99%.
- Signals can cross the closing boundary: recent rows show signals recorded at second **840**, exactly when new entries should stop.
- Filled trades do not store their exact ticker and strike. Settlement can therefore grade a fill against the last strike seen for that pair rather than the contract actually purchased.
- The real record is small: **12 settled live fills, 8 wins and 4 losses**. A loss alone is not proof of a bad signal, but the contract-mixing and over-calibration above are confirmed defects.

## Repair

1. **Lock every pair to one exact contract per candle**
   - Select only a market whose close time matches the active 15-minute period.
   - Pin its ticker and strike until that candle ends; never switch because another strike temporarily has a more balanced price.
   - Clear that pair's price history whenever a legitimate candle/ticker rollover occurs.
   - Reject stale, expired, mismatched, or ambiguous quotes instead of scoring them.

2. **Require a stable signal before displaying or trading it**
   - Require the same ticker, direction, and passing gates across consecutive fresh samples.
   - Re-run the complete signal decision against the final locked quote immediately before submitting an order—not only the price/slippage check.
   - Add a hard closing buffer so a signal computed before the cutoff cannot remain visible or be recorded after it.
   - Keep one pair/one contract/one order path shared by the dashboard and server runner.

3. **Fix learning and settlement integrity**
   - Calibrate from unique server decisions rather than every repeated browser/server observation.
   - Keep browser observations monitor-only and exclude them from production calibration and pair ranking.
   - Store the exact ticker and strike on every trade; settle each row against its own contract identity.
   - Do not treat a handcrafted confidence score as a calibrated probability until enough clean, unique samples exist.

4. **Reset only contaminated state**
   - Preserve the real `trade_log` as the money/audit record.
   - Clear `signal_log` and `market_snapshots`, because they contain mixed-contract and duplicate learning data.
   - Reset controls to the existing **Balanced** preset, **$5 stake**, **4 trades**, and **$20 daily loss cap**.
   - Keep live trading OFF through validation; do not silently risk money.

5. **Test before live use**
   - Add regression tests for contract selection, ticker locking, history reset, YES/NO direction mapping, closing-boundary rejection, unique calibration, and exact-contract settlement.
   - Run the existing safeguard suite plus the new tests and type checks.
   - Run the server runner while OFF across a full trade window and verify each pair keeps one ticker, signals persist before appearing, and no signal occurs at/after the cutoff.
   - Replay the clean captured window and inspect every fired decision against its exact spot, strike, book, direction, entry price, and result.

## Safety boundary

No signal can guarantee a win. The goal is to eliminate false signals caused by mixed contracts, stale state, duplicated learning, and boundary races. Live trading remains OFF after the repair until you deliberately turn it back on.
