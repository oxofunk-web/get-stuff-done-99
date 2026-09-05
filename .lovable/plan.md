# Retry failed market pulls and show real errors (never a blank panel)

## What happens today (verified in code)
- The dashboard asks the server for all 7 orderbooks every 8 seconds (`getMarkets` in `src/lib/kalshi.functions.ts`).
- If one pair's pull fails, that pair silently drops out — no retry, no message.
- If the whole pull fails, the panel shows "Kalshi feed unavailable — retrying…" **only when no data was ever loaded**. Once data exists, a failure leaves stale numbers on screen with no warning, and the next retry waits the full 8 seconds. The "Failed to fetch" errors in your console were this: a burst of failed pulls with no quick retry and no on-screen explanation.

## Changes

1. **Server retry (`src/lib/kalshi.functions.ts`)**
   - Retry each pair's market fetch up to 2 more times with a short pause (≈400ms, then ≈1s) before giving up.
   - Return per-pair status: for each pair either the orderbook or a short reason ("timeout", "HTTP 502", …). `ok` stays true if at least one pair loaded.

2. **Dashboard retry + stale handling (`src/hooks/useBot.ts`)**
   - On a failed pull, retry automatically after ~2s (up to 2 quick retries) instead of waiting the full 8s poll.
   - Keep the last good orderbooks on screen while retrying — never blank the panel.
   - Track `lastOkAt` timestamp and the real error message; only mark the feed down after 3 consecutive failures.

3. **Visible, honest status (`src/components/bot/MarketsPanel.tsx`)**
   - While showing older data during retries: amber "LIVE DATA STALE — retrying" chip with the seconds since last good pull.
   - After retries are exhausted: red chip with the actual error (e.g. "Kalshi returned HTTP 502") and a "Retry now" button.
   - Per-pair failure: that pair's row shows "unavailable — retrying" instead of vanishing.

4. **No changes to trading logic** — the server runner already skips pairs it can't price; this only makes failures visible and self-healing. Live trading stays OFF.

## Verification
- Typecheck (`bunx tsgo --noEmit`) and existing bot tests.
- In the preview: block the market request (devtools offline), confirm quick retries fire, stale chip appears with the real error, and the panel recovers on its own when the network returns.
