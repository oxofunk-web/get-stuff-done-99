# Show all 4 coins at once, with a live tick line

## Why only BTC shows today
The chart area shows one coin at a time and starts on BTC. The other coins only appear when you tap them in the top row.

## What changes (display only)
1. **Four charts at once**: BTC, ETH, SOL and XRP each get their own chart card. They sit in a 2x2 grid on desktop and stack on a phone. Each card shows the coin name, the up/down call with its chance, and the current price and move.
2. **Two views on each card**, switched with one CANDLES / LIVE toggle that applies to all four cards:
   - **CANDLES**: the existing 15-minute candle chart.
   - **LIVE**: a price line that updates every second from the live feed, with a dashed line at the candle's open. Above the open means the coin is finishing up, below means down.
3Tapping a card still selects that coin for the calls panel.

## Not changing
How the bot reads direction, the locks, the 8:00 window, the alerts, grading, and the edge math. This only changes what the screen shows.

## Technical details
- New `LiveLine.tsx`: an SVG line drawn from `spot[pair].ticks` (already in `useBrtiFeed`), plus an open reference from `openOf`.
- New `ChartGrid.tsx`: maps over PAIRS and renders `CandleChart` or `LiveLine` for each coin, using `d.seriesFor(p.id)`.
- `Dashboard.tsx`: replace the single chart section with ChartGrid. The toggle is kept in local state.
