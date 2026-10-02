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
- [x] Retry failed market pulls (server + dashboard) and show real errors instead of blank/stale panels
- [x] Stop logging junk samples ("outside window", "not enough data") so only real signals reach the live log
- [x] Keep live trading OFF; reset contaminated calibration to $5 / 1 trade / strict gates
- [x] Separate real-fill calibration from shadow and rejected signals; version strategy evidence
- [x] Settle real fills from finalized exchange results and preserve floor/cap contract rules
- [x] Count unsettled stake toward the daily loss cap and recheck the book immediately before sending
- [x] Replace optimistic replay depth with no-fill behavior when depth was not recorded
- [ ] Collect 100 independent settled shadow candidates before considering live approval

## Signal stability pass (de-saturated scoring)
- [x] Replace the hard confidence cap with a soft curve so scores spread instead of all reading 99.
- [x] Treat cushion as a band with an upper edge; reject reads already far in the money.
- [x] Cap the price of the leg we buy (80c) so one loss cannot erase several wins.
- [x] Check book depth before scoring, and again on the exact side we would buy.
- [x] Require three time-separated confirmations with a non-shrinking cushion.
- [x] One decision per pair per candle in the server runner.
- [x] Back on the strict profile: $5 stake, one trade per candle, live trading OFF.
- [ ] Run shadow validation windows before considering live trading again.
- [ ] Auto-sell locked-call trades when bid >= 93c
