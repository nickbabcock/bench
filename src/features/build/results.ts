/**
 * Build settings results: paired contrasts from one set of rounds.
 *
 * All seven variants (six artifacts plus the A/A control) run once per
 * round, in a rotating order, so any two can be compared round by round:
 * ratio_i = time(subject)_i ÷ time(reference)_i. Each contrast changes one
 * factor and holds the other fixed, and its effect is `pairedEffect` of
 * those ratios: the median, an order-statistic CI, and a claim only when
 * |median − 1| > 3% and the CI excludes 1.
 */
import { type PairedEffect, pairedEffect, pairedRatios } from "@/lib/stats";
import type { PerVariant, ResultRow } from "./harness";
import { AA, BASELINE, opts, simds, subjects, type VariantId, variantIds } from "./subjects";

type Contrast = {
  /** Stable key, e.g. "simd@Os", "skip-wasm-opt@off", "O3@on", "aa". */
  id: string;
  /** Numerator and denominator of every ratio. */
  subject: VariantId;
  reference: VariantId;
};

/**
 * The factor-specific contrasts:
 * - SIMD at fixed wasm-opt: on-X ÷ off-X for X ∈ {none, Os, O3};
 * - skipping wasm-opt at fixed SIMD: S-none ÷ S-Os;
 * - -O3 against -Os at fixed SIMD: S-O3 ÷ S-Os;
 * - the A/A control: off-Os (second instance) ÷ off-Os.
 * The full six-artifact matrix against the baseline is `againstBaseline`.
 */
const contrasts: readonly Contrast[] = [
  ...opts.map((o): Contrast => ({ id: `simd@${o}`, subject: `on-${o}`, reference: `off-${o}` })),
  ...simds.map((s): Contrast => ({ id: `skip-wasm-opt@${s}`, subject: `${s}-none`, reference: `${s}-Os` })),
  ...simds.map((s): Contrast => ({ id: `O3@${s}`, subject: `${s}-O3`, reference: `${s}-Os` })),
  { id: "aa", subject: AA, reference: BASELINE },
];

export const contrastById = (id: string) => contrasts.find((c) => c.id === id);

/** One contrast on one row (one workload on one input): the per-round time ratios, subject ÷ reference, in round order, and their effect. */
export function contrast(row: ResultRow, c: Contrast): { ratios: number[]; effect: PairedEffect } {
  const ratios = pairedRatios(row.samples[c.subject], row.samples[c.reference]);
  return { ratios, effect: pairedEffect(ratios) };
}

/** The full matrix: every variant's per-round time ÷ the baseline's, paired by round. */
export const againstBaseline = (row: ResultRow): PerVariant<PairedEffect> =>
  Object.fromEntries(variantIds.map((v) => [v, pairedEffect(pairedRatios(row.samples[v], row.samples[BASELINE]))])) as PerVariant<PairedEffect>;

/** "zstd decode · dickens"; alloc ignores the input. */
export const rowLabel = (row: Pick<ResultRow, "subject" | "input">) =>
  row.subject === "alloc" ? subjects[row.subject].label : `${subjects[row.subject].label} · ${row.input.name}`;
