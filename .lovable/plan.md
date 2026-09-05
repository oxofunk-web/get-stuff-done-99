# Show a "Saved" confirmation when controls change

## Goal
Make it obvious that every dashboard control change (bet size, gates, presets, EV margin, max trades, loss cap, on/off) has been received by the server and is now what the bot uses.

## Current behavior (verified)
- Every control already saves instantly via `updateServerBot` in `src/hooks/useBot.ts` (no "save" button; changes persist in the database and the bot re-reads them each tick, including mid-tick).
- There is no visible confirmation, so it's easy to wonder whether a change "took".

## Change
1. In `src/hooks/useBot.ts`: extend `applyServer` to set a `savedAt` timestamp (and the changed control's label) on success.
2. In `src/components/bot/EnginePanel.tsx`: show a small transient "✓ Saved" indicator near the controls that appears for ~2 seconds after each successful save; on failure, surface the existing error toast (already present).
3. Keep it subtle — matches the existing panel typography; no layout shifts.

## Verification
- Typecheck (`bunx tsgo --noEmit`), then flip a control in the preview and confirm the indicator appears and the value persists after a refresh.
- No changes to trading logic, gates, or settings defaults. Live trading stays OFF.
