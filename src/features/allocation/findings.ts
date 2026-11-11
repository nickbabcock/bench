/**
 * The Allocation page's fixed questions. The workload is repeated,
 * independently discardable document jobs (packages/alloc-workload);
 * the reader's question is whether to change the global allocator or
 * introduce an arena, and at what cost in time, permanent heap pages and
 * download bytes.
 *
 * General-purpose allocators and arenas do different jobs, so time and
 * heap growth are compared within a class (talc against dlmalloc,
 * bump-scope against bumpalo). What an arena costs and buys against
 * dlmalloc alone is one plain, rounded paragraph, never a main point.
 *
 * All four allocators run in every round, so time is compared paired: the
 * per-round ratio's median and 95% CI, with the site's claim rule. Heap
 * growth is deterministic per module and compared against one page and
 * 3%. Module sizes are exact build facts. Time is the one figure; pages
 * and bytes are exact, so they are table columns, cited as "(Figure 1;
 * table)".
 */
import {
  type Cell,
  type FigureQuestion,
  type Finding,
  listText,
  pct,
  type Relative,
  reproducedIn,
  scopeOf,
  timeChange,
  withinBudget,
} from "@/lib/findings";
import { formatBytes, formatInteger } from "@/lib/format";
import { geomean, median, type PairedClaim } from "@/lib/stats";
import { type Allocator, type AllocatorClass, allocators, BASELINE, classInfo, membersOf } from "./allocators";
import { name, pagesBytes, pairedTime, samePages, TOO_FEW } from "./claims";
import { type AllocationRun, growthPages } from "./harness";
import type { ModuleSizes } from "./sizes";

/** One allocation run, in one engine on one machine. */
export type AllocationCell = Cell & { run: AllocationRun };

/** What the questions read: the runs, and the build's module sizes (exact, so never gated). */
export type AllocationData = { cells: readonly AllocationCell[]; sizes?: ModuleSizes };

const pagesOf = (run: AllocationRun, a: Allocator) => growthPages(run.results[a]);
const at = (scope: string) => (scope ? ` ${scope}` : "");
const brotliDiff = (sizes: ModuleSizes | undefined, a: Allocator, b: Allocator = BASELINE) => (sizes ? sizes.modules[a].brotli - sizes.modules[b].brotli : undefined);
/** A class's baseline and the allocator compared against it (talc for dlmalloc, bump-scope for bumpalo). */
const pairOf = (c: AllocatorClass) => {
  const base = classInfo[c].baseline;
  return { base, subject: membersOf(c).find((a) => a !== base)! };
};
const kB = (bytes: number) => `${(Math.abs(bytes) / 1000).toFixed(2)} kB`;
/** Main points cite the time figure and the table, where pages and bytes are. */
const CITE = "(Figure 1; table)";

/** A run's kinds agree in every cell, or there is nothing to say in one word. */
const agreed = <T extends string>(kinds: T[]) => (kinds.every((k) => k === kinds[0]) ? kinds[0] : undefined);

/**
 * Time per document in a main point (Figure 1 says "per document"), from
 * the cells' agreed kind: "3.7% less time", "about the same time", "too
 * few rounds to compare time", or a clause saying the settings disagree.
 */
function timeClause(kind: PairedClaim | undefined, r: number): string {
  if (kind === undefined) {
    return "a time that depended on the setting";
  }
  if (kind === "insufficient") {
    return `${TOO_FEW} time`;
  }
  return kind === "same" ? "about the same time" : timeChange(r);
}

type PagesDir = "same" | "more" | "fewer" | "mixed";

/** Heap growth in a main point, in bytes (the table has the pages): "256 KiB more heap", "about the same heap". */
function pagesClause(diffs: number[], same: boolean[]): { text: string; dir: PagesDir } {
  if (same.every(Boolean)) {
    return { text: "about the same heap", dir: "same" };
  }
  if (!diffs.every((d, i) => !same[i] && d > 0) && !diffs.every((d, i) => !same[i] && d < 0)) {
    return { text: "heap growth that differed by setting", dir: "mixed" };
  }
  const more = diffs[0] > 0;
  const lo = Math.min(...diffs.map(Math.abs));
  const hi = Math.max(...diffs.map(Math.abs));
  const bytes = lo === hi ? pagesBytes(lo) : `${pagesBytes(lo).replace(/ (KiB|MiB)$/, (u) => (pagesBytes(hi).endsWith(u) ? "" : u))}–${pagesBytes(hi)}`;
  return { text: `${bytes} ${more ? "more" : "less"} heap`, dir: more ? "more" : "fewer" };
}

/** "1.72 kB" or "1.98–2.23 kB", magnitudes only. */
function kbRange(diffs: number[]): string {
  const lo = Math.min(...diffs.map(Math.abs));
  const hi = Math.max(...diffs.map(Math.abs));
  return kB(lo) === kB(hi) ? kB(lo) : `${kB(lo).replace(/ kB$/, "")}–${kB(hi)}`;
}

/** The brotli download in a main point: "a 1.72 kB smaller download". */
function bytesClause(diffs: number[]): string {
  if (diffs.length === 0) {
    return "";
  }
  if (diffs.every((d) => d === 0)) {
    return "a download of the same size";
  }
  if (!diffs.every((d) => d > 0) && !diffs.every((d) => d < 0)) {
    return "a download that changed by setting";
  }
  return `a ${kbRange(diffs)} ${diffs[0] > 0 ? "larger" : "smaller"} download`;
}

/** Joins clauses as "a, b and c". */
const clauses = (xs: string[]) => listText(xs.filter(Boolean));

// ---------------------------------------------------------------------------
// Figure 1: time per document, one panel per class on a shared axis
// ---------------------------------------------------------------------------

/** Within one class: does its other allocator take more or less time per document than the class's baseline? */
const withinClassTime = (c: AllocatorClass): FigureQuestion<AllocationData> => {
  const { base, subject } = pairOf(c);
  return {
    figure: 1,
    question: `Does ${name(subject)} take less time per document than ${name(base)}, within the ${classInfo[c].name.toLowerCase()} class?`,
    neutral: `${classInfo[c].name}: time per document`,
    answer: ({ cells }, replicates) => {
      // A cell counts only where every replicate gives the same direction there.
      const kind = reproducedIn(
        replicates?.map((r) => r.cells),
        (cell: AllocationCell) => pairedTime(cell.run, subject, base).claim,
      );
      for (const dir of ["faster", "slower"] as const) {
        const held = cells.filter((cell) => kind(cell) === dir);
        if (held.length === 0) {
          continue;
        }
        const r = geomean(held.map((cell) => pairedTime(cell.run, subject, base).median));
        const scope = scopeOf(held, cells);
        const sentence = `${name(subject)} took ${timeChange(r)} per document than ${name(base)}${at(scope)}`;
        return {
          title: sentence,
          claim: { key: `allocation.time.${c}:${subject}:${dir}`, text: `${sentence} (Figure 1).`, scope, cells: held },
        };
      }
      return {};
    },
  };
};

export const generalTime = withinClassTime("general");
export const arenaTime = withinClassTime("arena");

/** Figure 1's title from its two within-class findings: both joined, one alone, or neutral. */
export const TIME_NEUTRAL = "Time per document, within each allocator class";
export const timeTitle = (general: Finding, arena: Finding) =>
  [general, arena]
    .filter((f) => f.claim)
    // "per document" once: the second clause reads on from the first.
    .map((f, i) => (i === 0 ? f.title : f.title.replace(" per document", "")))
    .join("; ") || TIME_NEUTRAL;

/** The allocators a figure's headline claim is about, for their accent marks. */
export const claimAllocators = (f: Finding): Allocator[] => {
  const named = (f.claim?.key.split(":")[1] ?? "").split("+").map((p) => p.replace(/-(more|fewer)$/, ""));
  return allocators.filter((x) => named.includes(x));
};

// ---------------------------------------------------------------------------
// Main points: within-class decisions
// ---------------------------------------------------------------------------

/**
 * One decision per class, the same rule in every engine and machine: the
 * class's other allocator in place of its baseline (talc for dlmalloc,
 * bump-scope for bumpalo), in time, heap and download. Always a point
 * once measured, since heap and bytes are exact; its time clause is gated
 * with it, by the claim key. Read before Figure 1, so it carries the time
 * with its size; the heap is in bytes (the table has the pages).
 */
const classDecision = (c: AllocatorClass, keyPrefix: string): FigureQuestion<AllocationData> => {
  const { base, subject } = pairOf(c);
  return {
    figure: 1,
    question: `Should ${name(subject)} replace ${name(base)}: what changes in time, heap and download bytes?`,
    neutral: "",
    answer: ({ cells, sizes }) => {
      if (cells.length === 0) {
        return {};
      }
      const effects = cells.map((cell) => pairedTime(cell.run, subject, base));
      const kind = agreed(effects.map((e) => e.claim));
      const pages = pagesClause(
        cells.map((cell) => pagesOf(cell.run, subject) - pagesOf(cell.run, base)),
        cells.map((cell) => samePages(pagesOf(cell.run, subject), pagesOf(cell.run, base))),
      );
      const d = brotliDiff(sizes, subject, base);
      const scope = scopeOf(cells, cells);
      const body = `Replacing ${name(base)} with ${name(subject)}: ${clauses([timeClause(kind, geomean(effects.map((e) => e.median))), pages.text, d === undefined ? "" : bytesClause([d])])}`;
      // The scope when it fits the 25-word budget; a long one ("in Chrome 158 on this machine") is the Source line's.
      const scoped = `${body}${scope ? `, ${scope}` : ""} ${CITE}.`;
      const text = withinBudget([scoped, `${body} ${CITE}.`]);
      return {
        title: text,
        claim: { key: `${keyPrefix}:${kind ?? "mixed"}:${pages.dir}`, text, scope, cells },
      };
    },
  };
};

/** talc in place of dlmalloc. */
export const globalDecision = classDecision("general", "allocation.decision");

/** bump-scope in place of bumpalo: the same rule as the global allocator, so no engine drops one and keeps the other. */
export const arenaPair = classDecision("arena", "allocation.arenas");

/** The main points, in order: the global-allocator decision, then the arenas. */
export const pointQuestions = [globalDecision, arenaPair] as const;

// ---------------------------------------------------------------------------
// Main points over the whole edition: every engine and machine at once
// ---------------------------------------------------------------------------

/** One reference setting (an engine on a machine): its shown capture and the replicates that gate it. */
export type EditionSetting = { cell: AllocationCell; replicates: readonly AllocationCell[] };

/** "4%", "3.6–4%": the size of a claimed time ratio over several cells, magnitudes only. */
function timeSize(rs: readonly number[]): string {
  const ps = rs.map((r) => Math.abs(r - 1));
  const [lo, hi] = [pct(Math.min(...ps)), pct(Math.max(...ps))];
  return lo === hi ? lo : `${lo.slice(0, -1)}–${hi}`;
}

/**
 * One class's decision over every setting of the edition (talc for
 * dlmalloc, bump-scope for bumpalo), so it doesn't change with the
 * switches. Time is gated cell by cell: a setting counts only with the
 * kind every one of its captures gives (`reproducedIn`), and settings
 * that disagree are named apart, never averaged: "bump-scope vs bumpalo:
 * the same heap, 0.25 kB smaller download; 4% more time in Chrome and
 * Firefox, about the same in Safari (Figure 1; table)." Heap counts every
 * capture; the download is the build's.
 */
function editionDecision(c: AllocatorClass, settings: readonly EditionSetting[], sizes: ModuleSizes | undefined): { key: string; text: string } | undefined {
  if (settings.length === 0) {
    return undefined;
  }
  const { base, subject } = pairOf(c);
  // A fixed order (machine, then engine), so the wording never depends on which setting the page shows first.
  const all = settings.map((s) => s.cell).sort((a, b) => a.machine.id.localeCompare(b.machine.id) || a.engine.localeCompare(b.engine));
  const reps = Array.from({ length: Math.max(0, ...settings.map((s) => s.replicates.length)) }, (_, i) => settings.flatMap((s) => (s.replicates[i] ? [s.replicates[i]] : [])));
  const kind = reproducedIn(reps.length ? reps : undefined, (cell: AllocationCell) => pairedTime(cell.run, subject, base).claim);
  // Settings that agree share a clause: the largest group first, a claim before "about the same" on a tie.
  const order = (k: PairedClaim | undefined) => (k === "faster" || k === "slower" ? 0 : k === "same" ? 1 : 2);
  const grouped = new Map<PairedClaim | undefined, AllocationCell[]>();
  for (const cell of all) {
    grouped.set(kind(cell), [...(grouped.get(kind(cell)) ?? []), cell]);
  }
  const groups = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length || order(a[0]) - order(b[0]));
  const timeOf = (k: PairedClaim | undefined, cells: readonly AllocationCell[], noun: boolean) => {
    const t = noun ? " time" : "";
    if (k === "same") {
      return `about the same${t}`;
    }
    if (k === "faster" || k === "slower") {
      return `${timeSize(cells.map((cell) => pairedTime(cell.run, subject, base).median))} ${k === "faster" ? "less" : "more"}${t}`;
    }
    return k === "insufficient" ? `${TOO_FEW}${t}` : `unsettled${t}`;
  };
  const scope = (cells: readonly AllocationCell[]) => scopeOf(cells, all);
  const time = groups.map(([k, cells], i) => `${timeOf(k, cells, i === 0)}${at(scope(cells))}`).join(", ");
  const except = groups.length > 1 ? `${timeOf(groups[0][0], groups[0][1], true)}, except ${groups.slice(1).map(([k, cells]) => `${timeOf(k, cells, false)}${at(scope(cells))}`).join(" and ")}` : time;
  const captures = settings.flatMap((s) => [s.cell, ...s.replicates]);
  const diffs = captures.map((cell) => pagesOf(cell.run, subject) - pagesOf(cell.run, base));
  const pages = pagesClause(
    diffs,
    captures.map((cell) => samePages(pagesOf(cell.run, subject), pagesOf(cell.run, base))),
  );
  const heap = diffs.every((d) => d === 0) ? "the same heap" : pages.text;
  const d = brotliDiff(sizes, subject, base);
  const download = d === undefined ? "" : bytesClause([d]).replace(/^a /, "");
  const versus = `${name(subject)} vs ${name(base)}`;
  // Heap and download first (exact, the same everywhere), then time by setting; "except" when the full list won't fit.
  const exact = [heap, download].filter(Boolean).join(", ");
  const candidates = [`${versus}: ${exact}; ${time} ${CITE}.`, `${versus}: ${exact}; ${except} ${CITE}.`];
  const text = withinBudget(candidates);
  const key = `allocation.edition.${c}:${groups.map(([k, cells]) => `${k ?? "unreproduced"}@${cells.map((x) => x.engine).join("+")}`).join("|")}:${pages.dir}`;
  return { key, text };
}

/** The edition's main points, in order: the global allocator, then the arenas. */
export const editionDecisions = (settings: readonly EditionSetting[], sizes: ModuleSizes | undefined) =>
  (["general", "arena"] as const).flatMap((c) => {
    const p = editionDecision(c, settings, sizes);
    return p ? [p] : [];
  });

// ---------------------------------------------------------------------------
// What an arena costs and buys: a plain, rounded paragraph
// ---------------------------------------------------------------------------

const fractions: [number, string][] = [
  [1 / 10, "a tenth"],
  [1 / 8, "an eighth"],
  [1 / 6, "a sixth"],
  [1 / 5, "a fifth"],
  [1 / 4, "a quarter"],
  [1 / 3, "a third"],
  [1 / 2, "half"],
  [2 / 3, "two thirds"],
  [3 / 4, "three quarters"],
];

/** A share in rounded words: 0.21 "about a fifth", 0.27 "about a quarter", 0.41 "about 40%". */
export function roughShare(f: number): string {
  const near = fractions.find(([x]) => Math.abs(f - x) / x < 0.1);
  if (near) {
    return `about ${near[1]}`;
  }
  const p = f * 100;
  return `about ${p < 10 ? Math.max(1, Math.round(p)) : Math.round(p / 5) * 5}%`;
}

/** "about 26 MiB", "about 2.5 MiB", "about 640 KiB". */
const roughPages = (pages: number) => {
  const mib = (pages * 64) / 1024;
  return mib >= 10 ? `about ${Math.round(mib)} MiB` : mib >= 1 ? `about ${+mib.toFixed(1)} MiB` : `about ${Math.round(pages * 64)} KiB`;
};

/** "about 2 kB", "about 0.5 kB". */
const roughKB = (bytes: number) => {
  const k = Math.abs(bytes) / 1000;
  return `about ${k >= 1 ? Math.round(k) : +k.toFixed(1)} kB`;
};

/**
 * What an arena reset after each document costs and buys against dlmalloc
 * alone, rounded and plain: the whole application's time per document
 * (stated only when every capture agrees on a measured direction for both
 * arenas), the permanent heap, and the download. Not a main point: the
 * classes do different jobs, so this is context, not a ranking.
 */
export function arenaCost(
  primary: readonly AllocationRun[],
  /** Independent captures to gate the time on; undefined for this machine's run, which is not gated. */
  replicates: readonly (readonly AllocationRun[])[] | undefined,
  sizes: ModuleSizes | undefined,
): string | undefined {
  if (primary.length === 0) {
    return undefined;
  }
  const arenas = membersOf("arena");
  const effects = (runs: readonly AllocationRun[]) => runs.flatMap((run) => arenas.map((a) => pairedTime(run, a, BASELINE)));
  const kindsOf = (runs: readonly AllocationRun[]) => effects(runs).map((e) => e.claim);
  const kind = agreed(kindsOf(primary));
  const reproduced =
    kind !== undefined && kind !== "insufficient" && (replicates === undefined || (replicates.length > 0 && replicates.every((rs) => agreed(kindsOf(rs)) === kind)));
  const r = geomean(effects(primary).map((e) => e.median));
  const time = !reproduced
    ? ""
    : kind === "same"
      ? "the whole application took about the same time per document"
      : `the whole application took ${roughShare(Math.abs(1 - r))} ${kind === "faster" ? "less" : "more"} time per document`;
  const pairs = primary.flatMap((run) => arenas.map((a) => [pagesOf(run, a), pagesOf(run, BASELINE)] as const));
  const mean = pairs.reduce((s, [a, b]) => s + a - b, 0) / pairs.length;
  const heap = pairs.every(([a, b]) => samePages(a, b))
    ? "the permanent heap grew about the same"
    : `the permanent heap grew ${roughPages(Math.abs(mean))} ${mean > 0 ? "more" : "less"}`;
  const bytes = sizes ? arenas.map((a) => brotliDiff(sizes, a)!) : [];
  const meanBytes = bytes.length ? bytes.reduce((s, x) => s + x, 0) / bytes.length : 0;
  const download = !sizes ? "" : `the download was ${roughKB(meanBytes)} ${meanBytes > 0 ? "larger" : "smaller"}`;
  return `Against dlmalloc alone, with one arena reset after each document, ${clauses([time, heap, download])} ${CITE}.`;
}

/**
 * What the counting pass saw: allocator calls per batch. Counts only; an
 * end-to-end time can't be split into an allocator's share.
 */
export function allocatorCalls(run: AllocationRun): string {
  const docs = run.documents.sizes.length;
  const p = run.results[BASELINE].profile;
  return `In dlmalloc's build, each batch asks the allocator for ${formatInteger(p.allocs)} allocations, ${formatInteger(p.grows)} grows and ${formatInteger(p.frees)} frees (${formatBytes(p.bytes)} requested), about ${formatInteger(Math.round((p.allocs + p.grows) / docs))} allocations and grows per document, counted in an untimed pass.`;
}

// ---------------------------------------------------------------------------
// This machine against the reference
// ---------------------------------------------------------------------------

/** Speed per allocator (documents per ms), for relativeTo. */
export const allocatorSpeeds = (run: AllocationRun): Record<string, number> =>
  Object.fromEntries(allocators.map((a) => [a, 1 / median(run.results[a].samples)]));

/** Whether two runs processed the same document set, so their times compare. */
export const sameDocuments = (a: AllocationRun, b: AllocationRun) => a.documents.sizes.join() === b.documents.sizes.join();

/** This machine ÷ reference, per allocator, normalised by the overall geometric mean. */
export const allocationRelative: FigureQuestion<Relative> = {
  figure: 2,
  question: "Which allocators moved against the others on this machine, compared with the reference?",
  neutral: "This machine against the reference, per allocator",
  answer: (rel) => {
    const moved = (rel.moved as Allocator[]).map((a) => {
      const v = rel.normalized[a];
      return { a, text: `${name(a)} ${v > 1 ? `pulled ${pct(v - 1)} ahead of` : `fell ${pct(1 - v)} behind`}` };
    });
    if (moved.length === 0) {
      return {};
    }
    const title = `On this machine, ${listText(moved.map((m) => m.text))} the other allocators, compared with the reference`;
    return { title, claim: { key: `allocation.relative:${moved.map((m) => m.a).join("+")}`, text: `${title} (Figure 2).`, scope: "on this machine", cells: [] } };
  },
};
