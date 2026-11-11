/**
 * The RefCell against Mutex page's fixed questions. Every cell runs in
 * every round, so each question is a paired time ratio with the site's
 * claim rule, gated across independent captures setting by setting.
 */
import { ask, askReproduced, type Cell, type FigureQuestion, type Finding, reproducedIn, scopeOf, withinBudget } from "@/lib/findings";
import { geomean, isPairedClaim } from "@/lib/stats";
import { comparisonEffect, ratioWords } from "./claims";
import type { ResultRow } from "./harness";
import { buildComparisons, type Comparison, lockComparisons } from "./workloads";

/** One run, in one engine on one machine. */
export type LocksCell = Cell & { row: ResultRow };

/**
 * A question about one comparison. A cell holds a claim when its paired
 * ratio clears the rule and every replicate repeats that direction in the
 * same cell. Where cells disagree in direction, the larger group is the
 * claim (ties go to "slower") and the scope names where it holds.
 */
function comparisonQuestion(
  figure: number,
  comparison: Comparison,
  question: string,
  neutral: string,
  sentence: (words: string) => string,
): FigureQuestion<readonly LocksCell[]> {
  return {
    figure,
    question,
    neutral,
    answer: (cells, replicates) => {
      const kindOf = reproducedIn(replicates, (c: LocksCell) => {
        if (!c.row.checksumsMatch) {
          return undefined;
        }
        const e = comparisonEffect(c.row, comparison);
        return e && isPairedClaim(e.claim) ? e.claim : undefined;
      });
      const slower = cells.filter((c) => kindOf(c) === "slower");
      const faster = cells.filter((c) => kindOf(c) === "faster");
      const held = slower.length >= faster.length ? slower : faster;
      if (held.length === 0) {
        return {};
      }
      const r = geomean(held.map((c) => comparisonEffect(c.row, comparison)!.median));
      const measured = cells.filter((c) => comparisonEffect(c.row, comparison) !== undefined);
      const scope = scopeOf(held, measured);
      const words = ratioWords(r);
      const title = sentence(words) + (scope ? ` ${scope}` : "");
      const say = (where: string) => `${sentence(words)}${where ? ` ${where}` : ""} (Figure ${figure}).`;
      const count = `in ${held.length} of ${measured.length} browsers`;
      return {
        title,
        claim: {
          key: `locks.${comparison.id}:${held === slower ? "slower" : "faster"}`,
          text: withinBudget([say(scope), say(held.length === measured.length ? "" : count)]),
          scope,
          cells: held,
        },
      };
    },
  };
}

/** Figure 2: one Mutex lock against one RefCell borrow, in the default build. */
export const lockCost = comparisonQuestion(
  2,
  lockComparisons("abort")[0],
  "How long does one Mutex lock take against one RefCell borrow in the default build?",
  "Mutex ÷ RefCell, per build",
  (w) => `In the default build, one Mutex lock took ${w} one RefCell borrow`,
);

/** Figure 3: what panic=unwind does to one Mutex lock. */
export const unwindCost = comparisonQuestion(
  3,
  buildComparisons("unwind").find((c) => c.subject.workload === "op/mutex")!,
  "How long does one Mutex lock take with panic=unwind against the default build?",
  "Each build ÷ the default build, same workload",
  (w) => `With panic=unwind, one Mutex lock took ${w} in the default build`,
);

/** Figure 3: what +atomics does to one Mutex lock. */
export const atomicsCost = comparisonQuestion(
  3,
  buildComparisons("atomics").find((c) => c.subject.workload === "op/mutex")!,
  "How long does one Mutex lock take with +atomics against the default build?",
  "Each build ÷ the default build, same workload",
  (w) => `With +atomics, one Mutex lock took ${w} in the default build`,
);

export const locksQuestions = [lockCost, unwindCost, atomicsCost] as const;

/**
 * Every question for cells shown together, gated setting by setting:
 * replicate i holds every setting that has an i-th repeat. `replicates`
 * undefined: a this-machine run, not gated.
 */
export function gatedFindings(cells: readonly LocksCell[], replicates: readonly (readonly LocksCell[])[] | undefined): Finding[] {
  return locksQuestions.map((q) => (replicates === undefined ? ask(q, cells) : replicates.length ? ask(q, cells, replicates) : askReproduced(q, cells, [])));
}

/** Replicates index by index across settings: replicate i has every setting with an i-th repeat. */
export function replicatesOf<S>(settings: readonly S[], repeats: (s: S) => readonly ResultRow[], cellOf: (s: S, row: ResultRow) => LocksCell): LocksCell[][] {
  const n = Math.max(0, ...settings.map((s) => repeats(s).length));
  return Array.from({ length: n }, (_, i) => settings.flatMap((s) => (repeats(s)[i] ? [cellOf(s, repeats(s)[i])] : [])));
}

/** One reference setting (an engine on a machine) with its independent repeats. */
export type EditionSetting = { engine: string; machine: Cell["machine"]; run: ResultRow; replicates: readonly ResultRow[] };

/** The main points' findings over every setting of the edition, so no switch changes them. */
export function editionFindings(settings: readonly EditionSetting[]): Finding[] {
  const sorted = [...settings].sort((a, b) => a.machine.id.localeCompare(b.machine.id) || a.engine.localeCompare(b.engine));
  const cellOf = (s: EditionSetting, row: ResultRow): LocksCell => ({ engine: s.engine, machine: s.machine, input: null, row });
  return gatedFindings(
    sorted.map((s) => cellOf(s, s.run)),
    replicatesOf(sorted, (s) => s.replicates, cellOf),
  );
}

/** A figure's title from its findings: the first claim, else the neutral title. */
export const figureTitle = (findings: readonly Finding[], figure: number) => {
  const own = findings.filter((f) => f.figure === figure);
  return own.find((f) => f.claim)?.title ?? own[0]?.neutral ?? "";
};
