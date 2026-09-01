/**
 * Offline strategy harness. Run with:
 *   bun scripts/backtest.ts
 *   bun scripts/backtest.ts --candles 12 --bet 10 --vol 0.0006
 */
import {
  formatBacktest,
  makeSyntheticFrames,
  runBacktest,
} from "../src/lib/bot/backtest";
import { setSignalDebug } from "../src/lib/bot/signals";

const args = process.argv.slice(2);
const num = (flag: string, fallback: number) => {
  const i = args.indexOf(`--${flag}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

setSignalDebug(args.includes("--debug"));

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
  console.log(`\n=== ${s.name} ===`);
  console.log(formatBacktest(result));
}
