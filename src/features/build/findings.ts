/**
 * The Build settings page's fixed questions, by decision, in page order:
 * 1. SIMD and speed: on-Os ÷ off-Os, paired by round (the headline: its
 *    effect depends on the processor's architecture);
 * 2. skipping wasm-opt and speed: off-none ÷ off-Os, and -O3 against -Os
 *    (S-O3 ÷ S-Os) in one sentence;
 * 3. wasm-opt and download size (deterministic, from the manifests).
 *
 * Speed claims follow the paired rule (|median − 1| > 3% and a CI excluding
 * 1). A row whose A/A control fails (the baseline against a second instance
 * of itself clears the same bar) can't support any claim: its measurement
 * is biased, so it is reported in the table only.
 *
 * Reproduction is checked per cell, not just per headline: a reference
 * cell (one workload, input, engine and machine) holds a claim only when
 * the claim holds, in the same direction, in every independent capture of
 * that cell. So a headline's scope ("on all 3 inputs") is what every
 * capture supports, and its size is a range over exactly those cells,
 * never a value pooled across inputs that differ.
 */
import {
  type Answer,
  archLabel,
  type Cell,
  effectsDiffer,
  engineScope,
  type FigureQuestion,
  inputScope,
  listText,
  pct,
  scopeOf,
  sizeChange,
  timeChange,
  withinBudget,
} from "@/lib/findings";
import { isPairedClaim, isSmall, type PairedEffect, pairedEffect, PRACTICAL_FLOOR } from "@/lib/stats";
import { formatBytes } from "@/lib/format";
import type { ResultRow } from "./harness";
import { contrast, contrastById } from "./results";
import { type ArtifactId, type Crate, crateLabels, type Manifest, moduleNouns, type Opt, opts, type SubjectKey, subjects } from "./subjects";

/** One workload on one input, in one engine on one machine. */
export type BuildCell = Cell & {
  row: ResultRow;
  /**
   * The same row in each independent repeat capture (undefined where a
   * repeat lacks it). A reference claim must hold in every one. Omitted
   * for this machine's runs, which have no repeat to check against.
   */
  replicates?: (ResultRow | undefined)[];
};

const sameRow = (a: ResultRow, b: ResultRow) => a.subject === b.subject && (a.subject === "alloc" || a.input.name === b.input.name);

/**
 * Build cells for one capture (one engine, one machine). Pass the repeat
 * captures' rows to make every claim reproduce, cell by cell.
 */
export const buildCells = (
  rows: readonly ResultRow[],
  engine: string,
  machine: Cell["machine"],
  repeats?: readonly (readonly ResultRow[])[],
): BuildCell[] =>
  rows.map((row) => ({
    engine,
    machine,
    input: row.subject === "alloc" ? null : row.input.name,
    row,
    replicates: repeats?.map((rs) => rs.find((r) => sameRow(r, row))),
  }));

/** The A/A control on a row: a claim here means the row's timing is biased. */
export const aaEffect = (row: ResultRow) => contrast(row, contrastById("aa")!).effect;
export const aaFails = (row: ResultRow) => isPairedClaim(aaEffect(row).claim);

/** Every capture of a cell: the primary, then its repeats. */
const capturesOf = (cell: BuildCell) => [cell.row, ...(cell.replicates ?? [])];

/** Whether any capture of the cell failed its A/A control. */
export const cellBiased = (cell: BuildCell) => capturesOf(cell).some((r) => r !== undefined && aaFails(r));

/**
 * The claim a cell holds for a contrast: "faster" or "slower" only when it
 * holds in every capture and no capture's A/A failed; reference cells with
 * no repeat hold nothing. Otherwise "same".
 */
export function cellClaim(cell: BuildCell, contrastId: string): PairedEffect["claim"] {
  const c = contrastById(contrastId)!;
  const own = contrast(cell.row, c).effect.claim;
  if (!isPairedClaim(own) || cellBiased(cell) || (cell.replicates !== undefined && cell.replicates.length === 0)) {
    return own === "insufficient" ? own : "same";
  }
  return (cell.replicates ?? []).every((r) => r && contrast(r, c).effect.claim === own) ? own : "same";
}

/**
 * Cells whose primary capture made a claim that did not survive: a repeat
 * disagreed, or there is no repeat. (A/A-biased cells are reported apart.)
 */
export const unreproduced = (cells: readonly BuildCell[], contrastId: string) =>
  cells.filter((cell) => !cellBiased(cell) && isPairedClaim(contrast(cell.row, contrastById(contrastId)!).effect.claim) && !isPairedClaim(cellClaim(cell, contrastId)));

/**
 * Time ratios as a change in time, the site's convention (the figures'
 * "5% less time"): "6.3%–18.4%", or one value when the cells agree to the
 * shown precision. Unsigned; the verb says which way.
 */
function changeRange(medians: readonly number[]): string {
  const byStrength = [...medians].sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)));
  const weak = pct(byStrength[0] - 1);
  const strong = pct(byStrength[byStrength.length - 1] - 1);
  return weak === strong ? weak : `${weak}–${strong}`;
}

type Direction = "faster" | "slower";
type Candidate = { subject: SubjectKey; direction: Direction; held: BuildCell[]; size: number };

/** The strongest of some time ratios (largest |log|). */
const strongest = (medians: readonly number[]) => [...medians].sort((a, b) => Math.abs(Math.log(b)) - Math.abs(Math.log(a)))[0];

/** "zlib-rs inflate's time"; "the time of XML document processing (dlmalloc)". */
const timeOf = (label: string) => (label.endsWith(")") ? `the time of ${label}` : `${label}'s time`);

/**
 * A claimed effect in words, for a title: "cut zlib-rs inflate's time by
 * 4%–11.3%", or, when every cell's effect is under 5% (`isSmall`), "cut
 * zstd decode's time slightly, by 3.6%–4%".
 */
function effectPhrase(label: string, medians: readonly number[], direction: Direction): string {
  const verb = direction === "faster" ? "cut" : "raised";
  return `${verb} ${timeOf(label)}${medians.every((m) => isSmall(m)) ? " slightly," : ""} by ${changeRange(medians)}`;
}

/**
 * Per workload and direction, the cells where the claim holds (see
 * `cellClaim`): the workload that holds in the most cells first, then the
 * largest typical effect.
 */
function candidatesFor(cells: readonly BuildCell[], contrastId: string): Candidate[] {
  const c = contrastById(contrastId)!;
  const valid = cells.filter((cell) => !cellBiased(cell));
  const claims = new Map(valid.map((cell) => [cell, cellClaim(cell, contrastId)]));
  const out: Candidate[] = [];
  for (const s of [...new Set(valid.map((cell) => cell.row.subject))]) {
    for (const direction of ["faster", "slower"] as const) {
      const held = valid.filter((cell) => cell.row.subject === s && claims.get(cell) === direction);
      if (held.length) {
        const logs = held.map((cell) => Math.log(contrast(cell.row, c).effect.median));
        out.push({ subject: s, direction, held, size: Math.abs(logs.reduce((a, b) => a + b, 0) / logs.length) });
      }
    }
  }
  return out.sort((a, b) => b.held.length - a.held.length || b.size - a.size);
}

/**
 * "On arm64, " when every machine shares one known architecture; nothing
 * otherwise (the scope then names machines). The release header names
 * the machine and says the other architecture is not measured.
 */
function archLead(cells: readonly BuildCell[]): string {
  const arches = [...new Set(cells.map((c) => archLabel(c.machine.arch)))];
  return arches.length === 1 && ["arm64", "x86-64"].includes(arches[0]) ? `On ${arches[0]}, ` : "";
}

/** "on dickens", "on dickens and samba", "on all 3 inputs", "on 3 of 4 inputs"; "" with no inputs. */
function inputsPhrase(held: readonly string[], all: readonly string[]): string {
  const h = all.filter((x) => held.includes(x));
  if (h.length === 0 || all.length <= 1) {
    return "";
  }
  return h.length < all.length && h.length <= 2 ? `on ${listText(h)}` : inputScope(h, all);
}

/**
 * The scope of a main point's clause, compact: "on dickens and samba"
 * when every browser holds on the same inputs (no engine clause: it held
 * in all of them), "on all 3 inputs in Chrome and Safari" when only some
 * do, and per browser when they hold on different inputs ("on dickens in
 * Chrome and on samba in Firefox").
 */
function pointScope(held: readonly BuildCell[], all: readonly BuildCell[]): string {
  const inputs = [...new Set(all.flatMap((c) => (c.input === null ? [] : [c.input])))];
  const engines = [...new Set(all.map((c) => c.engine))];
  const byEngine = new Map<string, string[]>();
  for (const c of held) {
    byEngine.set(c.engine, [...(byEngine.get(c.engine) ?? []), ...(c.input === null ? [] : [c.input])]);
  }
  const sets = [...byEngine.values()].map((xs) => [...new Set(xs)].sort().join("\u0000"));
  if (sets.every((x) => x === sets[0])) {
    const first = [...byEngine.values()][0] ?? [];
    return [inputsPhrase(first, inputs), byEngine.size === engines.length ? "" : engineScope([...byEngine.keys()], engines)].filter(Boolean).join(" ");
  }
  return listText(engines.filter((e) => byEngine.has(e)).map((e) => `${inputsPhrase(byEngine.get(e)!, inputs)} in ${e}`));
}

/** "by 9.6%", or "up to 18.4%" when the cells differ at the shown precision. */
const amount = (medians: readonly number[]) => `${changeRange(medians).includes("–") ? "up to" : "by"} ${pct(strongest(medians) - 1)}`;

type SpeedWords = {
  /** Title subject: "simd128", "Skipping wasm-opt". */
  subject: string;
  /** Main-point subject, as it starts the sentence: "simd128", "Skipping wasm-opt". */
  verb: string;
  cite: string;
  /** Lead the main point with the architecture measured ("On arm64, …"). */
  arch?: boolean;
};

/** "by 9.6%", "by up to 18.4%": `amount` with its "by" always. */
const byAmount = (medians: readonly number[]) => {
  const a = amount(medians);
  return a.startsWith("by ") ? a : `by ${a}`;
};

/**
 * The headline speed claim for one contrast. The title states the
 * broadest effect as a range over the cells that hold it, with its full
 * scope. The main point is read first, so it stands alone: the lead
 * effect at its largest (with the browsers, when only some hold it), then
 * the workloads that moved the other way, the largest named with its size
 * and scope ("…, but slowed 3 workloads, zlib-rs deflate L6 most, by 9.6%
 * on x-ray in Chrome"). Within the 25-word budget it keeps as much as fits,
 * dropping scope detail first (the figure and Table 1 have it). Sizes are
 * numbers, so the point never says "slightly".
 */
function speedAnswer(cells: readonly BuildCell[], contrastId: string, words: SpeedWords): Answer {
  const c = contrastById(contrastId)!;
  const median = (cell: BuildCell) => contrast(cell.row, c).effect.median;
  const candidates = candidatesFor(cells, contrastId);
  if (candidates.length === 0) {
    return {};
  }
  const subjectCells = (x: Candidate) => cells.filter((cell) => cell.row.subject === x.subject);
  const scopeFor = (x: Candidate) => scopeOf(x.held, subjectCells(x));
  const lead = candidates[0];
  const scope = scopeFor(lead);
  const label = subjects[lead.subject].label;
  const enginesOf = (x: Candidate) => {
    const held = [...new Set(x.held.map((cell) => cell.engine))];
    const all = [...new Set(subjectCells(x).map((cell) => cell.engine))];
    return held.length < all.length ? engineScope(held, all) : "";
  };
  // The lead at its largest; its range and input scope are the title's. A restriction to some browsers is kept while it fits.
  const leadWith = (where: string) =>
    `${words.arch ? archLead(cells) : ""}${words.verb} ${lead.direction === "faster" ? "cut" : "raised"} ${timeOf(label)} ${byAmount(lead.held.map(median))}${where ? ` ${where}` : ""}`;
  // Every workload that reproduced the other way, the largest first.
  const against = candidates
    .filter((x) => x.direction !== lead.direction)
    .sort((a, b) => Math.abs(Math.log(strongest(b.held.map(median)))) - Math.abs(Math.log(strongest(a.held.map(median)))));
  const moved = lead.direction === "faster" ? "slowed" : "sped up";
  const top = against[0];
  /** The other-way clause at a level of detail: 0 full scope, 1 browsers only, 2 no scope, 3 the size without the name, 4 the name without the size. */
  const butClause = (detail: number) => {
    if (!top) {
      return "";
    }
    if (detail === 3 && against.length > 1) {
      return `, but ${moved} ${against.length} workloads ${byAmount(against.flatMap((x) => x.held.map(median)))}`;
    }
    const where = detail === 0 ? pointScope(top.held, subjectCells(top)) : detail === 1 ? enginesOf(top) : "";
    const size = detail >= 4 ? "" : ` ${byAmount(top.held.map(median))}`;
    const name = subjects[top.subject].label;
    return against.length === 1
      ? `, but ${moved} ${name}${size}${where ? ` ${where}` : ""}`
      : `, but ${moved} ${against.length} workloads, ${name} most${size ? `,${size}` : ""}${where ? ` ${where}` : ""}`;
  };
  const cite = ` (${words.cite}).`;
  const leadWhere = enginesOf(lead);
  const variants = [
    ...[0, 1, 2, 3, 4].map((d) => `${leadWith(leadWhere)}${butClause(d)}${cite}`),
    ...[2, 3, 4].map((d) => `${leadWith("")}${butClause(d)}${cite}`),
  ];
  const text = withinBudget(variants);
  return {
    title: `${words.subject} ${effectPhrase(label, lead.held.map(median), lead.direction)}${scope ? ` ${scope}` : ""}`,
    claim: {
      key: `build.${contrastId}:${lead.subject}:${lead.direction}`,
      // Already reproduced cell by cell (`cellClaim` checks every capture); listed for the shared gate.
      cells: lead.held,
      text,
      scope,
    },
    table: candidates.slice(1).map((x) => {
      const d = scopeFor(x);
      return {
        key: `build.${contrastId}:${x.subject}:${x.direction}`,
        cells: x.held,
        text: `${subjects[x.subject].label}: ${changeRange(x.held.map(median))} ${x.direction === "faster" ? "less" : "more"} time${d ? ` ${d}` : ""}.`,
        scope: d,
      };
    }),
  };
}

export const simdSpeed: FigureQuestion<readonly BuildCell[]> = {
  figure: 1,
  question: "Does building with SIMD (simd128) change speed, at wasm-opt -Os?",
  neutral: "Speed with simd128 against scalar, at wasm-opt -Os",
  answer: (cells) => speedAnswer(cells, "simd@Os", { subject: "simd128", verb: "simd128", cite: "Figure 1", arch: true }),
};

export const skipWasmOptSpeed: FigureQuestion<readonly BuildCell[]> = {
  figure: 2,
  question: "Does skipping wasm-opt change speed, without SIMD?",
  neutral: "Speed without wasm-opt against wasm-opt -Os",
  answer: (cells) => speedAnswer(cells, "skip-wasm-opt@off", { subject: "Skipping wasm-opt", verb: "Skipping wasm-opt", cite: "Figure 2" }),
};

/**
 * The -O3 sentence: its broadest effect at its largest, with its scope,
 * and whether any other workload held a claim (Table 1). One sentence.
 */
export function o3Sentence(cells: readonly BuildCell[]): string {
  const c = contrastById("O3@off")!;
  const candidates = candidatesFor(cells, "O3@off");
  if (candidates.length === 0) {
    return noSpeedChange("wasm-opt -O3 instead of -Os", cells, "Table 1");
  }
  const lead = candidates[0];
  const median = (cell: BuildCell) => contrast(cell.row, c).effect.median;
  const where = pointScope(
    lead.held,
    cells.filter((cell) => cell.row.subject === lead.subject),
  );
  const others = new Set(candidates.slice(1).map((x) => x.subject)).size;
  const rest = others ? `${others} other ${others === 1 ? "workload" : "workloads"} also changed` : `no other workload changed${capturesClause(cells)}`;
  return `Without SIMD, wasm-opt -O3 instead of -Os ${lead.direction === "faster" ? "cut" : "raised"} ${timeOf(subjects[lead.subject].label)} ${amount(lead.held.map(median))}${where ? ` ${where}` : ""}; ${rest} (Table 1).`;
}

/** Manifests by crate, then artifact: the deterministic size data. */
export type SizeData = Partial<Record<Crate, Partial<Record<ArtifactId, Manifest>>>>;

/** Brotli bytes of two builds of each crate that has both, and their ratio (a ÷ b). */
function brotliPairs(data: SizeData, a: ArtifactId, b: ArtifactId) {
  return (Object.keys(data) as Crate[]).flatMap((crate) => {
    const x = data[crate]?.[a]?.bytes.brotli;
    const y = data[crate]?.[b]?.bytes.brotli;
    return x && y ? [{ crate, a: x, b: y, r: x / y }] : [];
  });
}

/** "4 of 5 modules", "all 5 modules", "the zstd decoder". */
const moduleCount = (n: number, of: number, only?: Crate) =>
  n === 1 && only ? `the ${crateLabels[only]}` : n === of ? `all ${of} modules` : `${n} of ${of} modules`;

/**
 * What simd128 did to the brotli bytes at -Os, for the size figure's
 * title: "simd128 grew all 5", "simd128 grew 3 of 5 and shrank 2".
 */
function simdSizeClause(data: SizeData): string {
  const rows = brotliPairs(data, "on-Os", "off-Os");
  const grew = rows.filter((x) => x.r > 1).length;
  const shrank = rows.filter((x) => x.r < 1).length;
  const n = rows.length;
  const part = (k: number, verb: string) => (k === 0 ? "" : `${verb} ${k === n ? (n === 2 ? "both" : `all ${n}`) : `${k} of ${n}`}`);
  const words = [part(grew, "grew"), part(shrank, "shrank")].filter(Boolean);
  return words.length ? `simd128 ${listText(words)}` : "";
}

/**
 * wasm-opt -Os against no wasm-opt, scalar builds, in brotli bytes (what a
 * visitor downloads). Sizes are exact, so any change counts. The title
 * covers both series the figure draws (wasm-opt, then simd128); the main
 * point gives wasm-opt's sizes and names every module it grew.
 */
export const wasmOptSize: FigureQuestion<SizeData> = {
  figure: 3,
  question: "How much do wasm-opt -Os and simd128 change download size?",
  neutral: "Brotli-compressed size with and without wasm-opt, and with simd128",
  answer: (data) => {
    const rows = brotliPairs(data, "off-Os", "off-none");
    const shrank = rows.filter((x) => x.r < 1);
    const grew = rows.filter((x) => x.r > 1);
    if (shrank.length === 0) {
      return {};
    }
    const name = (crate: Crate) => `the ${crateLabels[crate]}`;
    const count = moduleCount(shrank.length, rows.length, shrank[0].crate);
    const simd = simdSizeClause(data);
    // The title has the counts and the bars the percentages; the point gives what a visitor downloads, in kB after compression.
    const saved = shrank.map((x) => x.b - x.a);
    const added = grew.map((x) => x.a - x.b);
    const upTo = (xs: number[]) => `${xs.length > 1 && Math.min(...xs) !== Math.max(...xs) ? "up to " : ""}${formatBytes(Math.max(...xs))}`;
    const which = shrank.length === 1 ? name(shrank[0].crate) : shrank.length === rows.length ? `all ${rows.length} modules` : shrank.length > rows.length / 2 ? "most modules" : `${shrank.length} of ${rows.length} modules`;
    const exception = grew.length ? `, but grew ${listText(grew.map((x) => name(x.crate)))} by ${upTo(added)}` : "";
    return {
      title: `wasm-opt -Os shrank ${count}${grew.length ? ` and grew ${listText(grew.map((x) => name(x.crate)))}` : ""}${simd ? `; ${simd}` : ""}`,
      claim: {
        key: `build.size:wasm-opt-Os:shrinks:${shrank.length}/${rows.length}`,
        text: `wasm-opt -Os shrank ${which} by ${upTo(saved)} after compression${exception} (Figure 3).`,
        scope: "",
      },
    };
  },
};

/** SIMD's size cost per crate at -Os, brotli bytes: the range across crates. */
function simdSizeRange(data: SizeData) {
  const rs = brotliPairs(data, "on-Os", "off-Os").map((x) => x.r);
  return rs.length ? { min: Math.min(...rs), max: Math.max(...rs), n: rs.length } : undefined;
}

/**
 * Signed: "simd128 made every module 0.2%–2.9% larger at wasm-opt -Os
 * (brotli bytes)", "… every module 1%–3% smaller …", or, when it went
 * both ways, "… changed each module's brotli bytes at wasm-opt -Os from
 * 0.5% smaller to 2.9% larger".
 */
export function simdSizeSentence(data: SizeData): string | undefined {
  const r = simdSizeRange(data);
  if (!r) {
    return undefined;
  }
  const bare = (x: number) => sizeChange(x).replace(/ (larger|smaller)$/, "");
  if (r.min >= 1 || r.max <= 1) {
    const [weak, strong] = r.min >= 1 ? [r.min, r.max] : [r.max, r.min];
    const span = bare(weak) === bare(strong) ? sizeChange(strong) : `${bare(weak)}–${sizeChange(strong)}`;
    return `simd128 made every module ${span} at wasm-opt -Os (brotli bytes).`;
  }
  return `simd128 changed each module's brotli bytes at wasm-opt -Os from ${sizeChange(r.min)} to ${sizeChange(r.max)}.`;
}

/** "in both captures", "in all 3 captures", or "" without repeats. */
const capturesClause = (cells: readonly BuildCell[]) => {
  if (cells.length === 0) {
    return "";
  }
  const n = Math.min(...cells.map((c) => (c.replicates ? c.replicates.length + 1 : 1)));
  return n < 2 ? "" : n === 2 ? " in both captures" : ` in all ${n} captures`;
};

/** The answer when a speed question claims nothing: "… in no workload …". */
const noSpeedChange = (verb: string, cells: readonly BuildCell[], cite: string) =>
  `${verb} changed the speed of no workload beyond the ±${pct(PRACTICAL_FLOOR)} threshold${capturesClause(cells)} (${cite}).`;

// ---------------------------------------------------------------------------
// Engines, machines and wasm-opt levels: where effects differ
// ---------------------------------------------------------------------------

/**
 * The informative rows of an effect figure, by row key: a row is shown
 * when any engine holds a claim on it (`cellClaim`), or when two engines'
 * effects differ (`effectsDiffer`) in every capture. A single capture with
 * no repeats (this machine) shows its claimed rows. Rows whose A/A failed
 * don't count.
 */
export function informativeRows(cells: readonly BuildCell[], contrastId: string): Set<string> {
  const c = contrastById(contrastId)!;
  const valid = cells.filter((cell) => !cellBiased(cell));
  const out = new Set<string>();
  const groups = new Map<string, BuildCell[]>();
  for (const cell of valid) {
    const k = `${rowKey(cell.row)}\u0000${cell.machine.id}`;
    groups.set(k, [...(groups.get(k) ?? []), cell]);
  }
  for (const group of groups.values()) {
    const key = rowKey(group[0].row);
    if (group.some((cell) => isPairedClaim(cellClaim(cell, contrastId)))) {
      out.add(key);
      continue;
    }
    for (let i = 0; i < group.length && !out.has(key); i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = capturesOf(group[i]);
        const b = capturesOf(group[j]);
        const n = Math.min(a.length, b.length);
        const all = Array.from({ length: n }, (_, k) => k).every((k) => {
          const ra = a[k];
          const rb = b[k];
          return ra !== undefined && rb !== undefined && effectsDiffer(contrast(ra, c).effect, contrast(rb, c).effect);
        });
        if (all) {
          out.add(key);
          break;
        }
      }
    }
  }
  return out;
}

/** What SIMD did at one wasm-opt level, in one cell. */
export type LevelEffect = { opt: Opt; median: number; claim: PairedEffect["claim"] };

/**
 * The SIMD × wasm-opt interaction: the cell where SIMD's effect changes
 * claim status across wasm-opt levels, consistently in every capture, with
 * the widest spread of medians. At most one, for one annotation.
 */
export function simdInteraction(cells: readonly BuildCell[]): { cell: BuildCell; levels: LevelEffect[] } | undefined {
  let best: { cell: BuildCell; levels: LevelEffect[]; spread: number } | undefined;
  for (const cell of cells) {
    if (cellBiased(cell)) {
      continue;
    }
    const levels = opts.map((opt): LevelEffect => {
      const e = contrast(cell.row, contrastById(`simd@${opt}`)!).effect;
      return { opt, median: e.median, claim: cellClaim(cell, `simd@${opt}`) };
    });
    const claimed = levels.map((l) => isPairedClaim(l.claim));
    if (claimed.every((x) => x === claimed[0])) {
      continue;
    }
    const ms = levels.map((l) => l.median);
    const spread = Math.max(...ms) / Math.min(...ms);
    if (!best || spread > best.spread) {
      best = { cell, levels, spread };
    }
  }
  return best && { cell: best.cell, levels: best.levels };
}

/**
 * Set under the row, in its engine's panel, naming the row it belongs to:
 * "lz4_flex decode on dickens, simd128 by wasm-opt level: none 9.7% less
 * time, -Os 7.3% less time, -O3 not claimed."
 */
export const interactionNote = (x: { cell: BuildCell; levels: LevelEffect[] }) =>
  `${subjects[x.cell.row.subject].label}${x.cell.input === null ? "" : ` on ${x.cell.input}`}, simd128 by wasm-opt level: ${x.levels.map((l) => `${l.opt === "none" ? "none" : `-${l.opt}`} ${isPairedClaim(l.claim) ? timeChange(l.median) : "not claimed"}`).join(", ")}.`;

// ---------------------------------------------------------------------------
// The A/A control
// ---------------------------------------------------------------------------

type AaFailure = {
  subject: SubjectKey;
  engine: string;
  /** Inputs where any capture failed, and how many of the subject's inputs there are. */
  inputs: string[];
  of: number;
};

/**
 * Where the A/A control failed, grouped by workload, engine and machine,
 * and, per engine, the largest A/A deviation among rows that passed: the
 * measured spread.
 */
export function aaSummary(cells: readonly BuildCell[]) {
  const groups = new Map<string, AaFailure>();
  const worst = new Map<string, number>();
  for (const cell of cells) {
    const caps = capturesOf(cell).filter((r): r is ResultRow => r !== undefined);
    for (const r of caps) {
      const d = Math.abs(aaEffect(r).median - 1);
      if (!aaFails(r) && Number.isFinite(d) && d > (worst.get(cell.engine) ?? -1)) {
        worst.set(cell.engine, d);
      }
    }
    if (!caps.some(aaFails)) {
      continue;
    }
    const key = `${cell.row.subject}\u0000${cell.engine}\u0000${cell.machine.id}`;
    const g = groups.get(key) ?? {
      subject: cell.row.subject,
      engine: cell.engine,
      inputs: [],
      of: cells.filter((c) => c.row.subject === cell.row.subject && c.engine === cell.engine && c.machine.id === cell.machine.id).length,
    };
    g.inputs.push(cell.input ?? "its input");
    groups.set(key, g);
  }
  return { failures: [...groups.values()], engines: [...new Set(cells.map((c) => c.engine))], worst };
}

/** "Chrome 156" → "Chrome"; "Chrome 142 on this machine" → "Chrome". */
const browserOf = (engine: string) => engine.split(" ")[0];

/**
 * The A/A figure's title: "A/A control: within ±2.2% in Chrome and
 * Firefox; failed for the zstd decoder and the XML module in Safari".
 */
export function aaTitle(cells: readonly BuildCell[]): string {
  const aa = aaSummary(cells);
  const failing = [...new Set(aa.failures.map((f) => f.engine))];
  const clean = aa.engines.filter((e) => !failing.includes(e));
  const within = (es: readonly string[]) => {
    const d = Math.max(0, ...es.map((e) => aa.worst.get(e) ?? 0));
    return `within ±${pct(d)}${aa.engines.length > 1 ? ` in ${listText(es.map(browserOf))}` : ""}`;
  };
  const failed = failing.map((e) => {
    const crates = [...new Set(aa.failures.filter((f) => f.engine === e).map((f) => subjects[f.subject].crate))];
    return `failed for ${listText(crates.map((c) => `the ${moduleNouns[c]}`))}${aa.engines.length > 1 ? ` in ${browserOf(e)}` : ""}`;
  });
  const parts = [clean.length ? within(clean) : "", ...failed].filter(Boolean);
  return parts.length ? `A/A control: ${parts.join("; ")}` : "A/A control";
}

/**
 * One A/A row per workload for the figure: every A/A ratio of the
 * workload in one engine on one machine, pooled over its inputs and
 * captures (the control's spread), and whether any of its rows failed.
 */
export function aaPooled(cells: readonly BuildCell[]) {
  const aa = contrastById("aa")!;
  type Acc = { subject: SubjectKey; engine: string; machine: Cell["machine"]; ratios: number[]; rejected: boolean; inputs: number; captures: number };
  const acc = new Map<string, Acc>();
  for (const cell of cells) {
    const k = `${cell.row.subject}\u0000${cell.engine}\u0000${cell.machine.id}`;
    const caps = capturesOf(cell).filter((r): r is ResultRow => r !== undefined);
    const a = acc.get(k) ?? { subject: cell.row.subject, engine: cell.engine, machine: cell.machine, ratios: [], rejected: false, inputs: 0, captures: caps.length };
    a.ratios.push(...caps.flatMap((r) => contrast(r, aa).ratios));
    a.rejected ||= cellBiased(cell);
    a.inputs++;
    acc.set(k, a);
  }
  return [...acc.values()].map((a) => ({
    subject: a.subject,
    engine: a.engine,
    machine: a.machine,
    rejected: a.rejected,
    inputs: a.inputs,
    captures: a.captures,
    effect: pairedEffect(a.ratios),
  }));
}

// ---------------------------------------------------------------------------
// This machine against the reference
// ---------------------------------------------------------------------------

/** Baseline speed per row (1 ÷ median ms of the shipped build), keyed by row label key. */
export const baselineSpeeds = (rows: readonly ResultRow[]): Record<string, number> =>
  Object.fromEntries(
    rows.map((r) => {
      const xs = [...r.samples["off-Os"]].sort((a, b) => a - b);
      const m = xs.length % 2 ? xs[xs.length >> 1] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
      return [rowKey(r), 1 / m];
    }),
  );

/** "zlib-rs-deflate-1:samba"; alloc has one row whatever its input. */
export const rowKey = (r: Pick<ResultRow, "subject" | "input">) => (r.subject === "alloc" ? "alloc" : `${r.subject}:${r.input.name}`);
