/**
 * The RefCell against Mutex page's fixed questions. Every cell runs in
 * every round, so each question is a paired time ratio with the site's
 * claim rule, gated across independent captures setting by setting.
 */
import { ask, askReproduced, replicatesOf, type Cell, type Claim, type FigureQuestion, type Finding, reproducedIn, scopeOf, times, withinBudget } from "@/lib/findings";
import { geomean, isPairedClaim } from "@/lib/stats";
import { comparisonEffect, ratioWords } from "./claims";
import type { ResultRow } from "./harness";
import { buildComparisons, type Comparison, lockComparisons } from "./workloads";

/** Above this max ÷ min of the browsers' ratios, a claim gives each browser its own number. */
const SPREAD = 1.1;

/** " and 2× in Firefox"; ", 2× in Firefox and 3× in Safari" for more. */
const listTail = (items: readonly string[]) =>
  items.length === 0 ? "" : items.length === 1 ? ` and ${items[0]}` : `, ${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

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
      // Where the browsers that hold the claim differ by more than SPREAD, each gets its own number: an average would be a
      // number that no browser measured. All in one format, so they compare at a glance ("1.23× as long as … in Chrome
      // and 1.63× in Firefox"); ratioWords would switch from % to × at 1.5.
      const each = held.map((c) => comparisonEffect(c.row, comparison)!.median);
      const split = held.length > 1 && Math.max(...each) / Math.min(...each) > SPREAD;
      const short = (r: number) => ratioWords(r).replace(/ (as|than)$/, "");
      const lead = (where: string) =>
        split
          ? `${sentence(`${times(each[0])} as long as`)} ${scopeOf([held[0]], measured)}${listTail(held.slice(1).map((c, i) => `${times(each[i + 1])} ${scopeOf([c], measured)}`))}`
          : `${sentence(ratioWords(ratio(held)))}${where ? ` ${where}` : ""}`;
      // Cells that reproduce the other direction get their own clause, so a reader does not take them as "about the same".
      const other = held === slower ? faster : slower;
      const but = (where: string) => (other.length ? `, but ${short(ratio(other))} ${where}` : "");
      const title = lead(scope) + but(scopeOf(other, measured));
      const say = (where: string, otherWhere: string) => `${lead(where)}${but(otherWhere)} (Figure ${figure}).`;
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
  (w) => `In the default build, a \`Mutex\` lock took ${w} a \`RefCell\` borrow`,
);

/** Figure 3: what panic=unwind does to one Mutex lock. */
export const unwindCost = comparisonQuestion(
  3,
  buildComparisons("unwind").find((c) => c.subject.workload === "op/mutex")!,
  "How long does one Mutex lock take with panic=unwind against the default build?",
  "Each build ÷ the default build, same workload",
  (w) => `With panic=unwind, a \`Mutex\` lock took ${w} with panic=abort`,
);

/** Figure 3: what +atomics does to one Mutex lock. */
export const atomicsCost = comparisonQuestion(
  3,
  buildComparisons("atomics").find((c) => c.subject.workload === "op/mutex")!,
  "How long does one Mutex lock take with +atomics against the default build?",
  "Each build ÷ the default build, same workload",
  (w) => `With +atomics, a \`Mutex\` lock took ${w} without it`,
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
