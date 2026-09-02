/**
 * Real-data threshold tuner.
 *
 *   bun scripts/tune.ts --hours 24
 *
 * Replays the recorded tape (`market_snapshots`): real Kalshi order books and
 * real BRTI spot, exactly as the engine saw them. Sweeps the signal filters
 * through the backtest harness and prints the grid sorted by ROI, so the
 * calibration gates real prices instead of a synthetic pricing model.
 */
import { runBacktest } from "../src/lib/bot/backtest";
import { formatReplayStats, framesFromSnapshots } from "../src/lib/bot/replay";
import { setSignalDebug } from "../src/lib/bot/signals";
import { setTuning, resetTuning } from "../src/lib/bot/tuning";
import { loadSnapshots } from "./load-snapshots";

const args = process.argv.slice(2);
const num = (flag: string, fallback: number) => {
  const i = args.indexOf(`--${flag}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

setSignalDebug(false);

const HOURS = num("hours", 24);
const MIN_TRADES = num("min-trades", 8);

const rows = await loadSnapshots(HOURS);
const { frames, stats } = framesFromSnapshots(rows);
console.log(formatReplayStats(stats));
if (!frames.length) {
  console.error(
    "no recorded snapshots in that window — leave the engine running so it records the tape, then re-run",
  );
  process.exit(1);
}

const grid: { threshold: number; minSkew: number; gateSecs: number; maxSpread: number }[] = [];
for (const threshold of [80, 84, 86, 90, 93]) {
  for (const minSkew of [0.04, 0.08, 0.12]) {
    for (const gateSecs of [480, 600, 720]) {
      for (const maxSpread of [0.03, 0.05]) {
        grid.push({ threshold, minSkew, gateSecs, maxSpread });
      }
    }
  }
}

const results = grid.map((g) => {
  resetTuning();
  setTuning(g);
  const r = runBacktest(frames, { betSize: 5, slippageCents: 2 });
  return { ...g, trades: r.trades.length, winRate: r.winRate, pnl: r.pnl, roi: r.roi };
});
resetTuning();

const ranked = results.filter((r) => r.trades >= MIN_TRADES).sort((a, b) => b.roi - a.roi);
if (!ranked.length) {
  console.log(
    `no combination reached ${MIN_TRADES} trades on this tape — record more hours or lower --min-trades`,
  );
}
ranked.slice(0, 15).forEach((r) => {
  console.log(
    `thr=${r.threshold} skew=${r.minSkew} gate=${r.gateSecs} spread=${r.maxSpread} → trades=${r.trades} win=${r.winRate.toFixed(1)}% pnl=$${r.pnl.toFixed(2)} roi=${r.roi.toFixed(1)}%`,
  );
});
