# Organize the dashboard UI

Right now all 11 panels are stacked in two long columns, so on a phone it reads as one endless scroll with no hierarchy. The fix is to group the panels into a few named sections with tab navigation, and to slim down the always-visible header.

## New structure

Four tabs, one purpose each:

```text
[ LIVE ]   [ BOT ]   [ TRADES ]   [ STATS ]
```

- LIVE — price/BRTI feed, candle clock, markets table
- BOT — server runner (why no order), engine controls (mode, size, max trades, EV margin, loss cap)
- TRADES — P&L, wallet, open positions, activity log
- STATS — pair edge, accuracy and rejection breakdown

Only the active tab renders, so each screen is short and scannable instead of a 3000px scroll.

## Header cleanup

- One compact top bar: status dot, app name, mode badge (PAPER / LIVE).
- The five stats (signals, placed, exposure, P&L, wallet) move into a single scroll-free strip under the title, with consistent label sizing instead of the current cramped wrap.
- Loss-cap "DAY STOPPED" banner and toast stay pinned at the top since they are alerts.

## Consistent panel look

- One shared `Panel` wrapper (title row, optional right-side action, body) applied to every panel so borders, padding, title size and spacing match everywhere.
- Standard numeric readout style (value + small caps label) reused across panels.
- Tighter mobile padding, single column under 640px, two columns on desktop within a tab.

## Not changing

Trading logic, signal thresholds, server engine, database, and all existing controls stay exactly as they are. This is presentation only — every control currently on screen remains reachable.

## Technical notes

- New `src/components/bot/Panel.tsx` (shared shell) and `src/components/bot/Stat.tsx` (readout).
- `Dashboard.tsx` gains local tab state and renders panel groups; tab bar sticky at the top on mobile.
- Existing panel components keep their props; only their internal chrome is swapped for the shared shell.
