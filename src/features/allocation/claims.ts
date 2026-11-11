import { changeShort, pct } from "@/lib/findings";
import { isPairedClaim, type PairedEffect, pairedEffect, pairedRatios, sameRatio, summarize, type Summary } from "@/lib/stats";
import { type Allocator, allocatorInfo, baselineOf, displayOrder } from "./allocators";
import { type AllocationRun, growthPages } from "./harness";

/**
 * One source for every Allocation comparison: the findings, figures, table
 * and exports all read these, so they always agree. All four allocators
 * run in every round (rotated), so samples are round-aligned and a
 * within-class comparison is paired: one time ratio per round, its median
 * and 95% CI, and the site's claim rule (beyond 3% and a CI excluding 1).
 * Comparisons are within a class (src/features/allocation/allocators.ts).
 */

export type Stat = {
  allocator: Allocator;
  /** Milliseconds per document. */
  summary: Summary;
  /** Paired time ratio against its class's baseline; null for a baseline itself. */
  effect: PairedEffect | null;
  /** The cold first batch, per document. */
  coldMs: number;
  /** Heap growth over the fixed sequence, in 64 KiB pages. */
  pages: number;
};

/**
 * `a`'s time ÷ `b`'s, paired by round. Samples are round-aligned by index
 * (the harness rotates all four allocators within each round), in old
 * editions too. Below six rounds there is no CI, so no claim.
 */
export const pairedTime = (run: AllocationRun, a: Allocator, b: Allocator): PairedEffect =>
  pairedEffect(pairedRatios(run.results[a].samples, run.results[b].samples));

/**
 * Every allocator's summary and its paired effect against its own class's
 * baseline (talc against dlmalloc, bump-scope against bumpalo), in display
 * order: by class, never ranked across classes.
 */
export function analyse(run: AllocationRun): Stat[] {
  return displayOrder.map((a) => ({
    allocator: a,
    summary: summarize(run.results[a].samples),
    effect: a === baselineOf(a) ? null : pairedTime(run, a, baselineOf(a)),
    coldMs: run.results[a].coldMs,
    pages: growthPages(run.results[a]),
  }));
}

export const name = (a: Allocator) => allocatorInfo[a].name;

/** What an insufficient paired effect says instead of a comparison. */
export const TOO_FEW = "too few rounds to compare";

/**
 * A paired effect in words: "3.7% more time", "about the same time" when
 * measured but not a claim, or "too few rounds to compare". `fixed` keeps
 * one decimal ("4.0% more time"), for the table's aligned column.
 */
export const effectText = (e: PairedEffect | null, fixed = false) =>
  e === null
    ? "class baseline"
    : isPairedClaim(e.claim)
      ? `${pct(e.median - 1, fixed)} ${e.median <= 1 ? "less" : "more"} time`
      : e.claim === "insufficient"
        ? TOO_FEW
        : "about the same time";

/** A CI of a time ratio in percent, one decimal throughout (the table aligns it): "3.4–4.3% more", "2.0–2.6% less", "1.0% less to 0.9% more". */
export function ciText(e: PairedEffect): string {
  if (!e.ci) {
    return "too few rounds for a CI";
  }
  const { lo, hi } = e.ci;
  if (hi <= 1) {
    return `${pct(1 - hi, true).slice(0, -1)}–${pct(1 - lo, true)} less`;
  }
  if (lo >= 1) {
    return `${pct(lo - 1, true).slice(0, -1)}–${pct(hi - 1, true)} more`;
  }
  return `${changeShort(lo, true)} to ${changeShort(hi, true)}`;
}

/** Whether two heap growths differ by at most one page or under 3%: not a finding. */
export const samePages = (a: number, b: number) => Math.abs(a - b) <= 1 || (a > 0 && b > 0 && sameRatio(a / b));

/** Pages as KiB or MiB: "192 KiB", "4.25 MiB", "6.5 MiB" (or "6.50 MiB" with `fixed`, for aligned columns). */
export const pagesBytes = (pages: number, fixed = false) => {
  const kib = pages * 64;
  return Math.abs(kib) >= 1024 ? `${fixed ? (kib / 1024).toFixed(2) : +(kib / 1024).toFixed(2)} MiB` : `${kib} KiB`;
};

/** Bytes as kB with two decimals and a sign: "−1.72 kB", "+2.23 kB", "0 kB". */
export const signedKB = (bytes: number) => (bytes === 0 ? "0 kB" : `${bytes > 0 ? "+" : "−"}${(Math.abs(bytes) / 1000).toFixed(2)} kB`);

/** Bytes as kB with two decimals: "16.44 kB". */
export const kBText = (bytes: number) => `${(bytes / 1000).toFixed(2)} kB`;
