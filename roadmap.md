# Roadmap

- [x] Reset all trade/signal/snapshot data and settings to a clean slate
- [x] Remove paper mode — single LIVE TRADING on/off switch, live immediately
- [x] Keep risk controls on the dashboard (bet size, max trades, EV margin, daily loss cap)
- [x] Fix root cause of "signals but no orders": flaky market fetch blanked whole rounds; seed last-known book from the tape; re-price off a fresh pull before every order
- [x] Remove exit management (take profit / stop out) — positions just settle
- [x] De-duplicate browser signal accuracy and label it monitor-only
- [x] Use a value-based chase ceiling with at most two order attempts per pair/candle
- [x] Flip LIVE TRADING ON and verify settings/heartbeat; typecheck + tests
- [x] Diagnose wrong signals: mixed contract streams, duplicate calibration, cutoff race, ambiguous settlement
- [x] Lock one contract per pair/candle and require stable repeated signals
- [x] Calibrate from unique server decisions and settle fills by exact contract
- [x] Reset contaminated signal/snapshot telemetry and restore conservative controls
- [ ] Run safeguards and observe the bot while OFF across a trade window
- [ ] Publish the latest execution fixes, then verify an autonomous fill in the next qualifying window
