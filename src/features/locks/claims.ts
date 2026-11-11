import { isExploratory } from "@/lib/evidence";
import { pct, times } from "@/lib/findings";
import { isPairedClaim, median, type PairedEffect, pairedEffect, pairedRatios } from "@/lib/stats";
import type { ResultRow } from "./harness";
import { type Comparison, lockComparisons, type Variant, type WorkloadId, workloadById } from "./workloads";

/** One cell's ns per operation, one per round; undefined when the build was not measured. */
export const samplesOf = (row: ResultRow, variant: Variant, workload: WorkloadId) => row.samples[variant]?.[workload];

/** One cell's median ns per operation. */
export const nsPerOp = (row: ResultRow, variant: Variant, workload: WorkloadId) => {
  const xs = samplesOf(row, variant, workload);
  return xs?.length ? median(xs) : NaN;
};

/**
 * A comparison as a paired time ratio, subject ÷ reference, with the
 * site's claim rule. Undefined when a build in it was not measured.
 */
export function comparisonEffect(row: ResultRow, c: Comparison): PairedEffect | undefined {
  const a = samplesOf(row, c.subject.variant, c.subject.workload);
  const b = samplesOf(row, c.reference.variant, c.reference.workload);
  return a && b ? pairedEffect(pairedRatios(a, b)) : undefined;
}

/** A workload against its baseline row in the same build (the table's "vs"), paired by round. */
export const baselineEffect = (row: ResultRow, variant: Variant, workload: WorkloadId) => {
  const base = workloadById[workload].baseline;
  return base === workload ? undefined : comparisonEffect(row, { id: "", label: "", subject: { workload, variant }, reference: { workload: base, variant } });
};

/**
 * A time ratio against a reference, before its noun: "2.4× as long as",
 * "34% longer than", "12% less time than".
 */
export const ratioWords = (r: number) => (r >= 1.5 ? `${times(r)} as long as` : r >= 1 ? `${pct(r - 1)} longer than` : `${pct(1 - r)} less time than`);

/** A paired effect in a table or figure: "2.4× as long", "about the same". */
export const effectWords = (e: PairedEffect) =>
  isPairedClaim(e.claim) ? ratioWords(e.median).replace(/ (as|than)$/, "") : e.claim === "insufficient" ? "too few rounds" : "about the same";

/** One line on a finished run, for the live region. */
export const runClaim = (row: ResultRow) => {
  if (!row.checksumsMatch) {
    return "Invalid comparison: the builds computed different answers.";
  }
  const e = comparisonEffect(row, lockComparisons("abort")[0])!;
  if (isExploratory(e.n)) {
    return "One sample per build, so no verdict.";
  }
  return isPairedClaim(e.claim)
    ? `In the default build, one Mutex lock took ${ratioWords(e.median)} one RefCell borrow.`
    : "In the default build, one Mutex lock and one RefCell borrow took about the same time.";
};
