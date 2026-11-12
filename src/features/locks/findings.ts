/**
 * The RefCell against Mutex page's fixed questions. Every cell runs in
 * every round, so each question is a paired time ratio with the site's
 * claim rule, gated across independent captures setting by setting.
 */
import { ask, askReproduced, replicatesOf, type Cell, type Claim, type FigureQuestion, type Finding, reproducedIn, scopeOf, withinBudget } from "@/lib/findings";
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
 * claim (ties go to "slower") and the scope names where it holds; a
 * "but" clause gives the other direction and where it holds.
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
        const e = comparisonEffect(c.row, comparison);
        return e && isPairedClaim(e.claim) ? e.claim : undefined;
      });
      const slower = cells.filter((c) => kindOf(c) === "slower");
      const faster = cells.filter((c) => kindOf(c) === "faster");
      const held = slower.length >= faster.length ? slower : faster;
      if (held.length === 0) {
        return {};
      }
      const ratio = (cs: readonly LocksCell[]) => geomean(cs.map((c) => comparisonEffect(c.row, comparison)!.median));
      const measured = cells.filter((c) => comparisonEffect(c.row, comparison) !== undefined);
      const scope = scopeOf(held, measured);
      const words = ratioWords(ratio(held));
      // Cells that reproduce the other direction get their own clause, so a reader does not take them as "about the same".
      const other = held === slower ? faster : slower;
      const otherWords = other.length ? ratioWords(ratio(other)).replace(/ (as|than)$/, "") : "";
      const but = (where: string) => (other.length ? `, but ${otherWords} ${where}` : "");
      const title = sentence(words) + (scope ? ` ${scope}` : "") + but(scopeOf(other, measured));
      const say = (where: string, otherWhere: string) => `${sentence(words)}${where ? ` ${where}` : ""}${but(otherWhere)} (Figure ${figure}).`;
      const count = (cs: readonly LocksCell[]) => `in ${cs.length} of ${measured.length} browsers`;
      return {
        title,
        claim: {
          key: `locks.${comparison.id}:${held === slower ? "slower" : "faster"}`,
          text: withinBudget([say(scope, scopeOf(other, measured)), say(held.length === measured.length ? "" : count(held), count(other))]),
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


/** One reference setting (an engine on a machine) with its independent repeats. */
export type EditionSetting = { engine: string; machine: Cell["machine"]; run: ResultRow; replicates: readonly ResultRow[] };

/**
 * The main points' findings over every setting of the edition, so no switch
 * changes them, and `pending`: the claims that the first captures make but
 * that the gate holds back (no second capture yet, or it did not hold).
 * The table reports those.
 */
export function editionFindings(settings: readonly EditionSetting[]): { findings: Finding[]; pending: Claim[] } {
  const sorted = [...settings].sort((a, b) => a.machine.id.localeCompare(b.machine.id) || a.engine.localeCompare(b.engine));
  const cellOf = (s: EditionSetting, row: ResultRow): LocksCell => ({ engine: s.engine, machine: s.machine, input: null, row });
  const cells = sorted.map((s) => cellOf(s, s.run));
  const findings = gatedFindings(cells, replicatesOf(sorted, (s) => s.replicates, cellOf));
  const pending = locksQuestions.flatMap((q, i) => (findings[i].claim ? [] : (ask(q, cells).claim ?? [])));
  return { findings, pending };
}

/** A figure's title from its findings: the first claim, else the neutral title. */
export const figureTitle = (findings: readonly Finding[], figure: number) => {
  const own = findings.filter((f) => f.figure === figure);
  return own.find((f) => f.claim)?.title ?? own[0]?.neutral ?? "";
};
