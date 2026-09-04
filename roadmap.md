# Roadmap

- [x] Reset all trade/signal/snapshot data and settings to a clean slate
- [x] Remove paper mode — single LIVE TRADING on/off switch, live immediately
- [x] Keep risk controls on the dashboard (bet size, max trades, EV margin, daily loss cap)
- [x] Fix root cause of "signals but no orders": flaky market fetch blanked whole rounds; seed last-known book from the tape; re-price off a fresh pull before every order
- [ ] Remove exit management (take profit / stop out) — positions just settle
- [ ] Verify the runner trades by itself across a full trade window; typecheck + tests
