/**
 * Offline strategy harness.
 *
 * Real recorded books + BRTI tape (default):
 *   bun scripts/backtest.ts --hours 24
 *
 * Synthetic sanity scenarios (kept for unit-style smoke checks only):
 *   bun scripts/backtest.ts --synthetic --candles 12 --bet 10
 */
import {
  formatBacktest,
  makeSyntheticFrames,
  runBacktest,
} from "../src/lib/bot/backtest";
import { formatReplayStats, framesFromSnapshots } from "../src/lib/bot/replay";
import { setSignalDebug } from "../src/lib/bot/signals";
import { loadSnapshots } from "./load-snapshots";

const args = process.argv.slice(2);
const num = (flag: string, fallback: number) => {
  const i = args.indexOf(`--${flag}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

setSignalDebug(args.includes("--debug"));

if (!args.includes("--synthetic")) {
  const hours = num("hours", 24);
  const rows = await loadSnapshots(hours);
  const { frames, stats } = framesFromSnapshots(rows);
  console.log(`=== recorded tape (last ${hours}h) ===`);
  console.log(formatReplayStats(stats));
  if (!frames.length) {
    console.error(
      "no recorded snapshots in that window — leave the engine running so it records the tape, then re-run",
    );
    process.exit(1);
  }
  const result = runBacktest(frames, {
    betSize: num("bet", 5),
    slippageCents: num("slippage", 2),
  });
  console.log(formatBacktest(result));
} else {
  const scenarios: { name: string; drift: number; vol: number }[] = [
    { name: "trend up", drift: 0.00002, vol: num("vol", 0.0004) },
    { name: "trend down", drift: -0.00002, vol: num("vol", 0.0004) },
    { name: "chop", drift: 0, vol: num("vol", 0.0004) },
  ];

  for (const s of scenarios) {
    const frames = makeSyntheticFrames({
      pairs: ["BTC", "ETH"],
      candles: num("candles", 8),
      drift: s.drift,
      vol: s.vol,
      seed: num("seed", 7),
      startPrice: 60000,
    });
    const result = runBacktest(frames, {
      betSize: num("bet", 5),
      slippageCents: num("slippage", 2),
    });
    console.log(`\n=== ${s.name} (synthetic) ===`);
    console.log(formatBacktest(result));
  }
}
