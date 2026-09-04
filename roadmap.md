# Roadmap

- [x] Reset all trade/signal/snapshot data and settings to a clean slate
- [x] Remove paper mode — single LIVE TRADING on/off switch, live immediately
- [x] Keep risk controls on the dashboard (bet size, max trades, EV margin, daily loss cap)
- [x] Fix root cause of "signals but no orders": flaky market fetch blanked whole rounds; seed last-known book from the tape; re-price off a fresh pull before every order
- [x] Remove exit management (take profit / stop out) — positions just settle
- [x] De-duplicate browser signal accuracy and label it monitor-only
- [x] Use a value-based chase ceiling with at most two order attempts per pair/candle
- [x] Flip LIVE TRADING ON and verify settings/heartbeat; typecheck + tests
- [ ] Publish the latest execution fixes, then verify an autonomous fill in the next qualifying window
