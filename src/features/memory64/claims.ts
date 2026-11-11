import { isExploratory } from "@/lib/evidence";
import { pct } from "@/lib/findings";
import { isPairedClaim, type PairedEffect, pairedEffect, pairedRatios, sameRatio } from "@/lib/stats";
import type { ResultRow } from "./harness";

/**
 * Every Memory64 percentage comes from one ratio, r = wasm64's median time
 * ÷ wasm32's, so the headline, chart, table, history, exports and
 * announcements always agree: at 90 ms against 100 ms, r = 0.9 reads −10%
 * and "takes 10% less time" everywhere.
 *
 * |r − 1| as a percentage, in the same format as the page (`pct`). Under
 * the practical floor it is truncated toward zero at the shown precision,
 * so a change called about the same never prints as 3%.
 */
const changeText = (r: number) => pct(sameRatio(r) ? Math.floor(Math.abs(r - 1) * 1000) / 1000 : r - 1);

/** r in words: "takes 8.2% longer", "takes 10% less time". */
const timeWords = (r: number) => (r >= 1 ? `takes ${changeText(r)} longer` : `takes ${changeText(r)} less time`);

const PAGE = 64 * 1024;

/** Peak memory within one 64 KiB page or under 3%: not a finding. */
export const memorySame = (row: ResultRow) =>
  Math.abs(Math.round(row.memoryBytes.wasm64 / PAGE) - Math.round(row.memoryBytes.wasm32 / PAGE)) <= 1 ||
  sameRatio(row.memoryBytes.wasm64 / row.memoryBytes.wasm32);

/**
 * wasm64 ÷ wasm32 time, paired by round: both builds run in every round
 * (alternating which goes first), so each round gives one ratio. The claim
 * follows the site rule: |median − 1| > 3% and a CI excluding 1.
 */
export const timeEffect = (row: Pick<ResultRow, "samples">): PairedEffect =>
  pairedEffect(pairedRatios(row.samples.wasm64, row.samples.wasm32));

/** One line on a finished run, for the live region. */
export const runClaim = (row: ResultRow) => {
  if (!row.checksumsMatch) {
    return "Invalid comparison: the builds computed different answers.";
  }
  const effect = timeEffect(row);
  if (isExploratory(effect.n)) {
    return "One sample per build, so no verdict.";
  }
  const time = isPairedClaim(effect.claim)
    ? `wasm64 ${timeWords(effect.median)} than wasm32`
    : effect.claim === "insufficient"
      ? `wasm64 ${timeWords(effect.median)} than wasm32 (too few rounds to claim a difference)`
      : "wasm64 and wasm32 take about the same time";
  const memDelta = row.memoryBytes.wasm64 / row.memoryBytes.wasm32 - 1;
  return `${time}, ${memorySame(row) ? "with about the same peak memory" : `and its peak memory is ${pct(memDelta)} ${memDelta > 0 ? "higher" : "lower"}`}.`;
};
