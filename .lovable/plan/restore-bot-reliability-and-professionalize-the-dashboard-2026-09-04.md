# Restore bot reliability and professionalize the dashboard

## Confirmed current state

- The autonomous server runner is enabled in live mode and its heartbeat is current, so the master switch and scheduler are active.
- It continuously records all seven pairs, but recent trade-window evaluations repeatedly report “not enough live data” even when the database already contains enough spot samples. This points to missing/flickering live market context during individual server runs, not a lack of recorded price history.
- The newer 52-second sampling loop is producing roughly twice the expected snapshot volume in several candles, consistent with overlapping scheduled runs. This adds load and makes state less deterministic.
- The server has created four recent live attempts: one filled XRP order that settled as a **+$1.98 win**, two ETH attempts skipped after the quote moved beyond the slippage cap, and one ETH attempt rejected for insufficient balance. A separate older client attempt was rejected for a thin book.
- Recorded outcomes show the server-generated fired opportunities performed materially better than the browser-generated ones in the available sample, so the work will preserve the server-only trader rather than blindly restoring the old client trader.
- The current UI places ten panels into two unrelated columns; on mobile they become one very long stack with controls, market context, results, and diagnostics mixed together.

## 1. Stabilize autonomous execution

- Add a database-backed single-run lease so one scheduled bot tick cannot overlap another.
- Replace the long overlapping loop with a bounded sampling strategy that reliably finishes before the next scheduled wake-up while still meeting the signal history requirement.
- Carry forward the newest valid market/ticker context per pair when one upstream lookup briefly returns empty, but require a fresh orderbook recheck immediately before any live order.
- Keep the server as the sole order placer, retain one trade per pair, the user-selected trade cap, $5 sizing, slippage protection, depth checks, live confirmation, and daily loss cap.
- Make every fired signal end in one explicit, durable result: placed, quote moved, insufficient balance, thin book, duplicate/cap, stale market, or order rejection.

## 2. Test quality before allowing changed behavior to trade live

- Build regression fixtures from the recorded market snapshots and settled signals, including the earlier working windows and the recent losing browser signals.
- Replay the same candles through the current and repaired pipelines; compare direction, entry price, qualification reason, fill eligibility, win/loss, and simulated P&L.
- Add focused tests for scheduler overlap, temporary market lookup gaps, quote refresh/slippage, per-candle limits, one-trade-per-pair behavior, balance failures, and daily loss cap.
- Run the repaired engine in paper/dry-run verification first. Do not submit test orders with real money.
- Only retain a behavior change when replay results and execution tests improve reliability without weakening the existing safety gates. If an older implementation performs better on the same recorded data, port the specific proven behavior instead of reverting the entire project.

## 3. Make the UI professional and organized

Use four clear workspaces while preserving every existing control and data source:

```text
[ OVERVIEW ]  [ BOT CONTROL ]  [ TRADES ]  [ ANALYTICS ]
```

- **Overview:** countdown, bot/runner health, wallet and today’s P&L, live spot prices, and open Kalshi markets.
- **Bot Control:** mode, on/off, size, trade cap, EV setting, loss cap, server heartbeat, and a prominent “Why no order?” timeline.
- **Trades:** open positions, recent fills/failures, realized/unrealized P&L, and refresh controls.
- **Analytics:** live signals, pair edge, accuracy, rejection reasons, and logs.
- Replace the cramped wrapping header with a compact status bar and consistent metric strip.
- Standardize panel headers, spacing, typography, status badges, alerts, tables, and empty states using the existing semantic design tokens.
- Make the mobile view short and navigable with a sticky tab bar; use a balanced 12-column layout inside desktop workspaces.
- Keep trading logic out of presentation components; the redesign only changes layout and visual structure.

## 4. End-to-end verification

- Run the complete unit/regression suite and type validation.
- Exercise the scheduled endpoint repeatedly in paper mode and verify there is only one active run, fresh data for eligible pairs, and a clear reason for every non-order.
- Verify dashboard controls still persist the exact same settings used by the server runner.
- Check the organized UI at phone and desktop sizes for readable hierarchy, no overlap, and reachable controls.
- Review resulting telemetry before any live-mode recommendation; report the measured sample size, win rate, simulated P&L, attempted orders, filled orders, and rejection breakdown without claiming profitability from a tiny sample.

## Safety boundary

No blind rollback and no loosening confidence/risk controls merely to create more trades. Historical versions are reference points only; changes must pass recorded-data replay and paper execution checks before they can affect live order placement.
