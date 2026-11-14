/**
 * The Memory64 page's fixed questions. wasm64 and wasm32 run in the same
 * rounds, so time is a paired ratio with the site's claim rule; peak
 * memory is deterministic and compared against the 64 KiB page / 3% floor.
 *
 * Both questions are answered in one figure (Figure 1), one pair of rows
 * per workload, so more workloads can join it as rows.
 */
import { ask, askReproduced, replicatesOf, type Cell, type FigureQuestion, type Finding, pct, type Relative, reproducedIn, scopeOf, timeChange, withinBudget } from "@/lib/findings";
import { geomean, isPairedClaim, median, type PairedClaim, type PairedEffect } from "@/lib/stats";
import { memorySame, timeEffect } from "./claims";
import type { ResultRow } from "./harness";
import { variants } from "./workloads";

/** One memory64 run, in one engine on one machine. */
export type Memory64Cell = Cell & { row: ResultRow };

/** A paired time effect's kind in one cell: a direction, "same", or "insufficient" (too few rounds; never read as "same"). */
const timeKind = (c: Memory64Cell): PairedClaim => timeEffect(c.row).claim;

/** One group of cells that agree on time: its scope and its words ("in Chrome", "13.2% less"). */
type TimeClause = { k: string; scope: string; words: string };

/**
 * The time main point, read before Figure 1, so it stands alone with its
 * size and, where engines disagree, the split: "wasm64 took 13.2% less
 * time than wasm32 in Chrome but about the same in Firefox; one workload,
 * cause not investigated (Figure 1)." A slow-down says what it buys
 * ("choose it only to address more than 4 GiB"); a speed-up carries its
 * caveat (against the usual cost of 64-bit pointers where it fits).
 */
function timeDecision(held: readonly Memory64Cell[], cells: readonly Memory64Cell[], kindOf: (c: Memory64Cell) => string, clauses: readonly TimeClause[]): string {
  const slower = held.filter((c) => kindOf(c) === "slower");
  const group = slower.length ? slower : held;
  const size = timeChange(geomean(group.map((c) => timeEffect(c.row).median)));
  const lead = clauses.find((c) => c.k === (slower.length ? "slower" : held.map(kindOf)[0]))!;
  const rest = clauses.filter((c) => c !== lead);
  const tails = slower.length
    ? [": choose it only to address more than 4 GiB (Figure 1).", ": choose it only for more than 4 GiB (Figure 1)."]
    : [", against the usual cost of 64-bit pointers; one workload, cause not investigated (Figure 1).", "; one workload, cause not investigated (Figure 1)."];
  // Every clause, each with its scope: "… in Chrome but about the same in Firefox".
  const split = rest.length ? ` but ${rest.map((c) => `${c.words}${c.scope ? ` ${c.scope}` : ""}`).join(" and ")}` : "";
  const full = tails.map((tail) => `wasm64 took ${size} than wasm32${lead.scope ? ` ${lead.scope}` : ""}${split}${tail}`);
  // Too long: the claim alone, its scope as a count, never dropped unless it holds in every cell.
  const count = group.length === cells.length ? "" : `in ${group.length} of ${cells.length} settings`;
  const say = (where: string) => `${where ? `${where.charAt(0).toUpperCase()}${where.slice(1)}, wasm64` : "wasm64"} took ${size} than wasm32${tails[0]}`;
  return withinBudget([...full, say(scopeOf(group, cells)), say(count)]);
}

/**
 * wasm64's time against wasm32's, split by engine where engines disagree:
 * "In Chrome 156, wasm64 took 13.2% less time than wasm32; in Firefox 151,
 * about the same". With one engine, or every engine alike, one clause
 * with its scope. A claim needs at least one cell with a paired claim
 * that every replicate repeats in that same cell; a cell whose direction
 * doesn't reproduce reads "not reproduced", and one with too few rounds
 * "too few rounds", never "about the same".
 */
export const memory64Time: FigureQuestion<readonly Memory64Cell[]> = {
  figure: 1,
  question: "How does wasm64's time compare with wasm32's on the same workload?",
  neutral: "wasm64 ÷ wasm32 time",
  answer: (cells, replicates) => {
    const valid = cells.filter((c) => c.row.checksumsMatch);
    const reproduced = reproducedIn(replicates, (c: Memory64Cell) => {
      const k = timeKind(c);
      return isPairedClaim(k) ? k : undefined;
    });
    // Each cell's word: a reproduced direction, or what stands in for one.
    const kindOf = (c: Memory64Cell) => reproduced(c) ?? (timeKind(c) === "same" ? "same" : timeKind(c) === "insufficient" ? "insufficient" : "unreproduced");
    const held = valid.filter((c) => kindOf(c) === "faster" || kindOf(c) === "slower");
    if (held.length === 0) {
      return {};
    }
    const order = ["faster", "slower", "same", "insufficient", "unreproduced"];
    const kinds = [...new Set(valid.map(kindOf))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const words = (k: string, group: Memory64Cell[]) =>
      k === "same" ? "about the same" : k === "insufficient" ? "too few rounds to compare" : k === "unreproduced" ? "a difference that did not reproduce" : timeChange(geomean(group.map((c) => timeEffect(c.row).median)));
    const clauses = kinds.map((k) => {
      const group = valid.filter((c) => kindOf(c) === k);
      return { k, scope: scopeOf(group, cells), words: words(k, group) };
    });
    const key = `memory64.time:${[...new Set(held.map(kindOf))].sort().join("+")}`;
    const text = timeDecision(held, cells, kindOf, clauses);
    if (clauses.length === 1) {
      const { scope, words: w } = clauses[0];
      return { title: `wasm64 took ${w} than wasm32${scope ? ` ${scope}` : ""}`, claim: { key, text, scope, cells: held } };
    }
    const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    const [first, ...rest] = clauses;
    const tail = rest.map((c) => `${c.scope}, ${c.words}`).join("; ");
    return {
      title: `${cap(first.scope)}, wasm64 took ${first.words} than wasm32; ${tail}`,
      claim: { key, text, scope: clauses.map((c) => c.scope).join("; "), cells: held },
    };
  },
};

/** Peak memory: "higher" or "lower" beyond a page and 3%, else "same". */
const memoryDirection = (row: ResultRow) => (memorySame(row) ? "same" : row.memoryBytes.wasm64 > row.memoryBytes.wasm32 ? "higher" : "lower");

/** A cell's peak memory verdict: a direction, or none when the same or the checksums differ. */
const memoryKind = (c: Memory64Cell) => {
  const d = memoryDirection(c.row);
  return !c.row.checksumsMatch || d === "same" ? undefined : d;
};

/** "1.5 MiB", "320 KiB": three significant figures without trailing zeros. */
const mib = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${Number((bytes / 1024 / 1024).toPrecision(3))} MiB`);

/** "1.5 MiB", "1.5–1.6 MiB": the unit once. */
const mibRange = (xs: readonly number[]) => {
  const [lo, hi] = [mib(Math.min(...xs)), mib(Math.max(...xs))];
  return lo === hi ? lo : lo.slice(-4) === hi.slice(-4) ? `${lo.slice(0, -4)}–${hi}` : `${lo}–${hi}`;
};

/**
 * The memory main point, in bytes (Figure 1's title has the percentage):
 * "wasm64 peaked at 40.8 MiB, 1.5 MiB more than wasm32's 39.3 MiB, in
 * Chrome and Firefox (Figure 1)."
 */
function memoryBudget(held: readonly Memory64Cell[], scope: string): string {
  const diffs = held.map((c) => Math.abs(c.row.memoryBytes.wasm64 - c.row.memoryBytes.wasm32));
  const more = held[0].row.memoryBytes.wasm64 > held[0].row.memoryBytes.wasm32;
  const peaks = (k: "wasm64" | "wasm32") => mibRange(held.map((c) => c.row.memoryBytes[k]));
  const say = (where: string) =>
    `wasm64 peaked at ${peaks("wasm64")}, ${mibRange(diffs)} ${more ? "more" : "less"} than wasm32's ${peaks("wasm32")}${where ? `, ${where}` : ""} (Figure 1).`;
  // With its scope if that fits the budget, else without (the Source line names the setting).
  return withinBudget([say(scope), say("")]);
}

export const memory64Memory: FigureQuestion<readonly Memory64Cell[]> = {
  figure: 1,
  question: "How does wasm64's peak memory compare with wasm32's?",
  neutral: "wasm64 ÷ wasm32 peak memory",
  answer: (cells, replicates) => {
    // Only cells whose direction every replicate repeats, there.
    const kind = reproducedIn(replicates, memoryKind);
    const held = cells.filter((c) => kind(c) !== undefined);
    if (held.length === 0) {
      return {};
    }
    const rs = held.map((c) => c.row.memoryBytes.wasm64 / c.row.memoryBytes.wasm32);
    if (!(rs.every((r) => r > 1) || rs.every((r) => r < 1))) {
      return {};
    }
    const more = rs[0] > 1;
    const r = geomean(rs);
    const scope = scopeOf(held, cells);
    return {
      title: `wasm64 peaked ${pct(r - 1)} ${more ? "higher" : "lower"} than wasm32${scope ? ` ${scope}` : ""}`,
      claim: {
        key: `memory64.memory:${more ? "higher" : "lower"}`,
        text: memoryBudget(held, scope),
        scope,
        cells: held,
      },
    };
  },
};

export const memory64Questions = [memory64Time, memory64Memory] as const;

/** One reference setting (an engine on a machine) with its independent repeats. */
export type EditionSetting = { engine: string; machine: Cell["machine"]; run: ResultRow; replicates: readonly ResultRow[] };

/**
 * Time and peak memory for settings shown together, gated setting by
 * setting, as Allocation does: replicate i holds every setting that has an
 * i-th repeat, so a setting missing a repeat drops out of the time claim
 * alone, never the others. Peak memory is deterministic, so it never
 * waits on a repeat. `replicates` undefined: a this-machine run, not gated.
 */
export function gatedFindings(cells: readonly Memory64Cell[], replicates: readonly (readonly Memory64Cell[])[] | undefined): [Finding, Finding] {
  const time = replicates === undefined ? ask(memory64Time, cells) : replicates.length ? ask(memory64Time, cells, replicates) : askReproduced(memory64Time, cells, []);
  return [time, ask(memory64Memory, cells)];
}


/**
 * The main points' findings over every setting of the edition (every
 * engine on every machine), so no switch changes them. Settings are put
 * in a fixed order first.
 */
export function editionFindings(settings: readonly EditionSetting[]): Finding[] {
  const sorted = [...settings].sort((a, b) => a.machine.id.localeCompare(b.machine.id) || a.engine.localeCompare(b.engine));
  const cellOf = (s: EditionSetting, row: ResultRow): Memory64Cell => ({ engine: s.engine, machine: s.machine, input: null, row });
  return gatedFindings(
    sorted.map((s) => cellOf(s, s.run)),
    replicatesOf(sorted, (s) => s.replicates, cellOf),
  );
}

/** The neutral title of Figure 1, when neither question makes a headline claim. */
export const NEUTRAL_TITLE = "wasm64 ÷ wasm32, time and peak memory";

/**
 * Figure 1's title from its two findings: both claims joined ("wasm64
 * took 12% less time than wasm32 and peaked 3.8% higher"), one claim alone,
 * or the neutral title. A time claim split by engine keeps its clauses and
 * adds the memory as its own clause.
 */
export function figureTitle(time: Finding, memory: Finding, cells: readonly Memory64Cell[] = []): string {
  if (time.claim && memory.claim) {
    const scope = time.claim.scope ? ` ${time.claim.scope}` : "";
    // One shared scope reads once, at the end: "… less time and peaked 4% higher than wasm32 in Chrome".
    if (time.claim.scope === memory.claim.scope && time.title.endsWith(` than wasm32${scope}`)) {
      return `${time.title.slice(0, -` than wasm32${scope}`.length)} and ${memory.title.replace(/^wasm64 /, "")}`;
    }
    // Time split by engine: the memory as its own clause, "in both" when it holds everywhere.
    const everywhere = cells.length > 1 && memory.claim.scope === scopeOf(cells, cells);
    const where = everywhere ? (cells.length === 2 ? " in both" : " in all") : memory.claim.scope ? ` ${memory.claim.scope}` : "";
    const peak = memory.title.replace(/^wasm64 peaked (.*) than wasm32.*$/, "$1");
    return `${time.title}; its peak memory was ${peak}${where}`;
  }
  return time.claim ? time.title : memory.claim ? memory.title : NEUTRAL_TITLE;
}

// ---------------------------------------------------------------------------
// This machine against the reference
// ---------------------------------------------------------------------------

/** Speed per build (sessions per ms), for relativeTo. */
export const buildSpeeds = (row: ResultRow): Record<string, number> => Object.fromEntries(variants.map((v) => [v, 1 / median(row.samples[v])]));

/** A paired time effect in words: "13.6% less time", "about the same". */
export const effectWords = (e: PairedEffect) =>
  isPairedClaim(e.claim) ? timeChange(e.median) : e.claim === "insufficient" ? `${timeChange(e.median)}; too few rounds to claim` : "about the same time";

/** This machine ÷ reference, per build, normalised by the overall geometric mean. */
export const memory64Relative: FigureQuestion<Relative> = {
  figure: 2,
  question: "Did one build move against the other on this machine, compared with the reference?",
  neutral: "This machine against the reference, per build",
  answer: (rel) => {
    const moved = rel.moved.map((v) => `${v} ${rel.normalized[v] > 1 ? `pulled ${pct(rel.normalized[v] - 1)} ahead` : `fell ${pct(1 - rel.normalized[v])} behind`}`);
    if (moved.length === 0) {
      return {};
    }
    const title = `On this machine, ${moved.join(" and ")}, compared with the reference`;
    return { title, claim: { key: `memory64.relative:${rel.moved.join("+")}`, text: `${title} (Figure 2).`, scope: "on this machine", cells: [] } };
  },
};
