/**
 * Findings: figure titles and main points computed from data, never typed.
 *
 * Every figure declares a fixed question and a pure function that answers
 * it from measurements. The answer is either a claim (with its scope:
 * inputs, engines, machines, levels) or nothing, in which case the figure
 * keeps its neutral title ("Ratio against decompression speed").
 *
 * A claim reaches a headline (figure title or main point) only when it
 * reproduces: the same claim, by key, comes out of a second independent
 * capture (`gate`). Otherwise it is downgraded to the table.
 *
 * Generators live with their benchmarks (src/features/<bench>/findings.ts);
 * this module holds the shared shapes and wording helpers.
 */
import { geomean, isPairedClaim, type PairedEffect, PRACTICAL_FLOOR } from "./stats";

export type Claim = {
  /**
   * Stable identity for the reproduction gate: what is claimed and in
   * which direction, but not its size ("build.simd:zlib-rs-inflate:faster").
   */
  key: string;
  /** The main-point sentence, citing its figure: "… (Figure 2)." */
  text: string;
  /** Where it holds: "on 3 of 4 inputs, in Chrome and Firefox". */
  scope: string;
  /**
   * The cells (engine, machine, input) the claim holds in: the `held`
   * its scope was built from. The gate then requires each one to hold
   * the same claim in every replicate, so a claim seen only in Chrome in
   * one capture and only in Firefox in the other does not reproduce.
   * Every generator should set it.
   */
  cells?: readonly Cell[];
  figure: number;
};

export type Finding = {
  figure: number;
  question: string;
  /** The figure title: the claim's title when there is a claim, else `neutral`. */
  title: string;
  claim?: Claim;
  /** The title to fall back to when nothing is claimed or reproduced. */
  neutral: string;
  /** Claims that didn't reproduce (or lost out to the headline): table only. */
  tableOnly: Claim[];
};

/** What a generator returns: a title and claim, or nothing to claim. */
export type Answer = { title: string; claim: Omit<Claim, "figure">; table?: Omit<Claim, "figure">[] } | { title?: undefined; claim?: undefined; table?: Omit<Claim, "figure">[] };

export type FigureQuestion<D> = {
  figure: number;
  /** The fixed question the figure answers. */
  question: string;
  /** Title when nothing clears the bar ("Ratio against decompression speed"). */
  neutral: string;
  /**
   * The answer from one capture. `replicates`, when given, are the other
   * captures of the same setting: a generator can narrow its claim to the
   * cells that reproduce (`reproducedIn`) before building its scope, so
   * the gate keeps a narrower claim instead of dropping it.
   */
  answer: (data: D, replicates?: readonly D[]) => Answer;
};

/** Answer a figure's question from data (and, for narrowing, its replicates). */
export function ask<D>(q: FigureQuestion<D>, data: D, replicates?: readonly D[]): Finding {
  const a = q.answer(data, replicates);
  const withFigure = (c: Omit<Claim, "figure">): Claim => ({ ...c, figure: q.figure });
  return {
    figure: q.figure,
    question: q.question,
    neutral: q.neutral,
    title: a.claim ? a.title : q.neutral,
    claim: a.claim ? withFigure(a.claim) : undefined,
    tableOnly: (a.table ?? []).map(withFigure),
  };
}

/** A cell's identity across captures: engine, machine and input. */
export const cellKey = (c: Cell) => `${c.engine}\u0000${c.machine.id}\u0000${c.input ?? ""}`;

/**
 * Whether a claim reproduces in one replicate: the replicate makes a claim
 * with the same key, and, when the claim lists its cells, the replicate's
 * claim holds in every one of them (per engine, machine and input, not
 * just somewhere).
 */
function reproducesIn(claim: Claim, replicate: Finding): boolean {
  const r = replicate.claim;
  if (!r || r.key !== claim.key) {
    return false;
  }
  if (!claim.cells) {
    return true;
  }
  if (!r.cells) {
    return false;
  }
  const held = new Set(r.cells.map(cellKey));
  return claim.cells.every((c) => held.has(cellKey(c)));
}

/**
 * The reproduction gate. A claim stays a headline only if every replicate
 * (an independent capture answered by the same question) makes a claim with
 * the same key, holding in each of the claim's cells (`Claim.cells`). With
 * no replicate, nothing is reproduced. A claim that fails moves to
 * `tableOnly`, and the title falls back to neutral.
 */
export function gate(primary: Finding, replicates: readonly Finding[]): Finding {
  if (!primary.claim) {
    return primary;
  }
  const reproduced = replicates.length > 0 && replicates.every((r) => reproducesIn(primary.claim!, r));
  return reproduced ? primary : { ...primary, title: primary.neutral, claim: undefined, tableOnly: [primary.claim, ...primary.tableOnly] };
}

/**
 * Answer a question for a primary capture and its replicates, then gate
 * it. The primary is answered with the replicates in hand, so a generator
 * can narrow its claim to reproduced cells first.
 */
export const askReproduced = <D,>(q: FigureQuestion<D>, primary: D, replicates: readonly D[]) =>
  gate(
    ask(q, primary, replicates),
    replicates.map((r) => ask(q, r)),
  );

/**
 * Per-cell reproduction, for generators: a verdict function that keeps a
 * primary cell's verdict (a claim direction, say) only where every
 * replicate gives the same verdict at the same engine, machine and input,
 * and returns `undefined` ("no claim") elsewhere. Build `held` from it,
 * then the scope, so the scope names only cells that reproduced:
 *
 *   const kind = reproducedIn(replicates, cellKind);
 *   const held = cells.filter((c) => kind(c) === "faster");
 *   … scope: scopeOf(held, cells), cells: held
 *
 * With no replicates (a this-machine run) it is the verdict unchanged.
 */
export function reproducedIn<C extends Cell, V>(replicates: readonly (readonly C[])[] | undefined, verdict: (c: C) => V | undefined): (c: C) => V | undefined {
  if (!replicates || replicates.length === 0) {
    return verdict;
  }
  const maps = replicates.map((cells) => new Map(cells.map((c) => [cellKey(c), verdict(c)])));
  return (c) => {
    const v = verdict(c);
    return v !== undefined && maps.every((m) => m.get(cellKey(c)) === v) ? v : undefined;
  };
}

/**
 * Replicates index by index across settings shown together: replicate i
 * has every setting with an i-th repeat. A setting without that repeat
 * drops out of a claim alone, never the others.
 */
export function replicatesOf<S, R, C>(settings: readonly S[], repeats: (s: S) => readonly R[], cellOf: (s: S, row: R) => C): C[][] {
  const n = Math.max(0, ...settings.map((s) => repeats(s).length));
  return Array.from({ length: n }, (_, i) => settings.flatMap((s) => (repeats(s)[i] ? [cellOf(s, repeats(s)[i])] : [])));
}

/** A main point's budget, in rendered words (the brief's S2). */
export const POINT_WORDS = 25;

/** Words in a rendered sentence, its citations included: the main-point budget counts them all. */
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The first candidate main point within the word budget, or the last (the shortest) when none fits. */
export const withinBudget = (candidates: readonly string[]) => candidates.find((t) => wordCount(t) <= POINT_WORDS) ?? candidates[candidates.length - 1];

/** Up to three main points, one per figure, in figure order. */
export const mainPoints = (findings: readonly Finding[], max = 3): string[] =>
  findings
    .filter((f) => f.claim)
    .sort((a, b) => a.figure - b.figure)
    .slice(0, max)
    .map((f) => f.claim!.text);

// ---------------------------------------------------------------------------
// Numbers in words
// ---------------------------------------------------------------------------

/**
 * A percentage, unsigned. In prose, at most one decimal: 12.3%, 4%, 0.4%.
 * With `fixed`, always one decimal (4.0%, 12.3%), for a column of values
 * that must align.
 */
export function pct(fraction: number, fixed = false): string {
  const p = Math.abs(fraction * 100);
  if (!Number.isFinite(p)) {
    return "—";
  }
  return `${fixed ? p.toFixed(1) : Number(p.toFixed(1)).toString()}%`;
}

/** A factor: "12×", "2.6×", and two decimals below 2 ("1.05×", "0.87×"). */
export const times = (x: number) => `${Number(x.toFixed(x >= 10 ? 0 : x >= 2 ? 1 : 2)).toString()}×`;

/**
 * A time ratio (subject ÷ reference) as a change in speed. Speed is 1/time,
 * so r = 0.8 reads "25% faster" and r = 1.25 "20% slower". From twice as
 * fast, it reads as a factor: r = 0.25 is "4× faster".
 */
export function speedChange(r: number): string {
  const speed = 1 / r;
  if (speed >= 2) {
    return `${times(speed)} faster`;
  }
  return speed >= 1 ? `${pct(speed - 1)} faster` : `${pct(1 - speed)} slower`;
}

/** A time ratio as a change in time: r = 0.9 "10% less time", r = 1.1 "10% more time". */
export const timeChange = (r: number) => (r <= 1 ? `${pct(1 - r)} less time` : `${pct(r - 1)} more time`);

/** A time ratio as a bare change: "3.7% more", "2.4% less"; `fixed` keeps one decimal ("4.0% more"). */
export const changeShort = (r: number, fixed = false) => `${pct(r - 1, fixed)} ${r < 1 ? "less" : "more"}`;

/** Whether a speed ratio is the same speed, to the words' precision. */
const sameSpeed = (speed: number) => Math.abs(speed - 1) < 5e-4;

/**
 * A speed ratio (higher is faster) against `than`: "at the same speed as
 * Chrome 156", "5.2% slower than Chrome 156", or "5.2% slower" when `than`
 * is "" (the caller names it once).
 */
const speedAgainst = (speed: number, than: string) =>
  sameSpeed(speed) ? `at the same speed as ${than}` : `${speedChange(1 / speed)}${than ? ` than ${than}` : ""}`;

/** A size ratio (subject ÷ reference): "12.3% smaller", "4.2% larger". */
export const sizeChange = (r: number) => (r <= 1 ? `${pct(1 - r)} smaller` : `${pct(r - 1)} larger`);

/** "a", "a and b", "a, b and c". */
export const listText = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// ---------------------------------------------------------------------------
// Scope: where a claim holds
// ---------------------------------------------------------------------------

export type MachineRef = { id: string; cpuModel: string; arch: string };

/** One measured setting a claim can hold in: an engine on a machine, on an input. */
export type Cell = { engine: string; machine: MachineRef; input: string | null };

const numberWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * "on dickens" (one of several), "on both inputs", "on all 4 inputs",
 * "on 3 of 4 inputs". Empty when the measurement has no inputs, or only one
 * and it holds there (the release header already names it), unless
 * `always` is set.
 */
export function inputScope(held: readonly string[], all: readonly string[], noun = "inputs", always = false): string {
  const h = all.filter((x) => held.includes(x));
  if (all.length === 0 || h.length === 0) {
    return "";
  }
  if (all.length === 1) {
    return always ? `on ${h[0]}` : "";
  }
  if (h.length === 1) {
    return `on ${h[0]}`;
  }
  if (h.length === all.length) {
    return all.length === 2 ? `on both ${noun}` : `on all ${all.length} ${noun}`;
  }
  return `on ${h.length} of ${all.length} ${noun}`;
}

/** "in Chrome", "in Chrome and Firefox", "in all 3 browsers". */
export function engineScope(held: readonly string[], all: readonly string[]): string {
  const h = all.filter((x) => held.includes(x));
  if (h.length === 0) {
    return "";
  }
  if (h.length === all.length && all.length > 2) {
    return `in all ${all.length} browsers`;
  }
  return `in ${listText(h)}`;
}

/** "x86-64", "arm64". */
export const archLabel = (arch: string) => (arch === "x86_64" || arch === "amd64" ? "x86-64" : arch === "aarch64" ? "arm64" : arch);

/**
 * A machine in one format on every page header: "Apple M4 Pro (arm64) ·
 * macOS 26.5.2". The OS build ("(25F84)") is the Measurement notes'; the
 * browser is never part of it.
 */
export const machineLabel = (m: { cpuModel: string; arch: string; os?: string }) =>
  `${m.cpuModel} (${archLabel(m.arch)})${m.os ? ` · ${m.os.replace(/\s*\(.*\)$/, "")}` : ""}`;

/**
 * The scope of a claim that holds in `held`, out of `all` measured cells.
 * When the held cells form a full grid (the same inputs in every engine),
 * it reads "on 3 of 4 inputs, in Chrome and Firefox"; otherwise engines
 * that hold on the same inputs share a clause: "on dickens, in Chrome; on
 * x-ray, in Firefox". All reference captures come from one machine, so the
 * scope does not name machines.
 */
export function scopeOf(held: readonly Cell[], all: readonly Cell[]): string {
  const inputs = [...new Set(all.flatMap((c) => (c.input === null ? [] : [c.input])))];
  const engines = [...new Set(all.map((c) => c.engine))];
  const groups = new Map<string, Cell[]>();
  for (const c of held) {
    groups.set(c.engine, [...(groups.get(c.engine) ?? []), c]);
  }
  const inputsOf = (cs: Cell[]) => [...new Set(cs.flatMap((c) => (c.input === null ? [] : [c.input])))].sort().join("\u0000");
  const join = (...parts: string[]) => parts.filter(Boolean).join(", ");
  const clauses = new Map<string, Cell[][]>();
  for (const cs of groups.values()) {
    const key = inputsOf(cs);
    clauses.set(key, [...(clauses.get(key) ?? []), cs]);
  }
  // A full grid (one clause) puts its input scope first; a ragged one lists every clause's inputs.
  const grid = clauses.size <= 1;
  return [...clauses.values()]
    .map((gs) =>
      join(
        inputScope(
          gs[0].flatMap((c) => (c.input === null ? [] : [c.input])),
          inputs,
          "inputs",
          !grid,
        ),
        engineScope(
          gs.map((cs) => cs[0].engine),
          engines,
        ),
      ),
    )
    .join("; ");
}

/** "one", "two", … for small counts in prose; digits from 11. */
const countWord = (n: number) => numberWords[n] ?? String(n);

/** A noun, singular, or as a [singular, plural] pair when the plural isn't "+s". */
export type Noun = string | readonly [string, string];

/** "1 configuration", "4 configurations", "1 sample round"; digits, for counts beside figures. */
export const countOf = (n: number, noun: Noun) => {
  const [one, many] = typeof noun === "string" ? [noun, `${noun}s`] : noun;
  return `${n} ${n === 1 ? one : many}`;
};

// ---------------------------------------------------------------------------
// Comparing engines, machines, and this machine against the reference
// ---------------------------------------------------------------------------

/**
 * How two paired effects of one comparison, measured in two settings (two
 * engines, or two machines), differ, if they do:
 * - "direction": both are claims, in opposite directions. Always counts.
 * - "status": one is a claim and the other isn't, and the medians are at
 *   least threshold ÷ 2 apart. (A claim at 3.1% beside "about the same" at
 *   2.9% is not a difference.)
 * - "size": the medians differ by more than the threshold.
 *
 * The status rule is deliberate: a claim-status flip whose medians nearly
 * coincide says only that one interval was wider, which is sampling noise,
 * not a difference between engines. Two effects with the same 0.96 median, one
 * claimed and one not, therefore return undefined. A direction flip
 * always counts.
 */
export type EffectDifference = "direction" | "status" | "size";

export function effectsDifference(a: PairedEffect, b: PairedEffect, threshold = PRACTICAL_FLOOR): EffectDifference | undefined {
  const ca = isPairedClaim(a.claim);
  const cb = isPairedClaim(b.claim);
  const gap = Math.abs(a.median - b.median);
  if (ca && cb && a.claim !== b.claim) {
    return "direction";
  }
  if (ca !== cb && gap >= threshold / 2) {
    return "status";
  }
  return gap > threshold ? "size" : undefined;
}

/**
 * The "large" rule for one paired effect measured in two settings:
 * a direction flip, a claim-status flip with medians at least threshold ÷ 2
 * apart, or medians more than the threshold apart (`effectsDifference`).
 */
export const effectsDiffer = (a: PairedEffect, b: PairedEffect, threshold = PRACTICAL_FLOOR): boolean => effectsDifference(a, b, threshold) !== undefined;

export type Relative = {
  /** Geometric mean of current ÷ reference over the shared configurations. */
  geomean: number;
  min: number;
  max: number;
  /** Configurations both datasets measured. */
  k: number;
  /** Per configuration: (current ÷ reference) ÷ geomean. */
  normalized: Record<string, number>;
  /** Configurations whose relative standing moved beyond the threshold. */
  moved: string[];
};

/**
 * How one dataset ran against another, configuration by configuration:
 * "This machine ran at N× the reference overall (geometric mean over K
 * configurations; range a–b)". Values are throughputs or speeds (higher is
 * faster); pass times inverted.
 */
export function relativeTo(reference: Record<string, number>, current: Record<string, number>, threshold = PRACTICAL_FLOOR): Relative | undefined {
  const ids = Object.keys(current).filter((id) => reference[id] > 0 && current[id] > 0);
  if (ids.length === 0) {
    return undefined;
  }
  const ratios = ids.map((id) => current[id] / reference[id]);
  const overall = geomean(ratios);
  const normalized = Object.fromEntries(ids.map((id, i) => [id, ratios[i] / overall]));
  return {
    geomean: overall,
    min: Math.min(...ratios),
    max: Math.max(...ratios),
    k: ids.length,
    normalized,
    moved: ids.filter((id) => Math.abs(normalized[id] - 1) > threshold),
  };
}

/**
 * The computed sentence for a This machine view, in words: "This machine
 * ran 5% faster than the reference overall (geometric mean over 10
 * configurations; from 2% slower to 9% faster)." `geomean`, `min` and
 * `max` are speed ratios (higher is faster).
 */
export const relativeSentence = (r: Relative, subject = "This machine", reference = "the reference", unit: Noun = "configuration") => {
  const speed = (x: number) => speedChange(1 / x);
  const overall = speedAgainst(r.geomean, reference);
  const range = r.k < 2 ? "" : speed(r.min) === speed(r.max) ? `; each ${speed(r.min)}` : `; from ${speed(r.min)} to ${speed(r.max)}`;
  return `${subject} ran ${overall} overall (geometric mean over ${countOf(r.k, unit)}${range}).`;
};

// ---------------------------------------------------------------------------
// Withheld settings
// ---------------------------------------------------------------------------

/** One setting the drift gate withholds (src/data/editions `withheld`). */
export type WithheldItem = { browser: string; name?: string; input?: string; factor: number; outliers: number; captures?: number };

const browserName = (w: WithheldItem) => w.name ?? w.browser.charAt(0).toUpperCase() + w.browser.slice(1);

/**
 * One sentence per browser on what the drift gate withheld, or "" when
 * nothing was: "Safari's two captures of samba disagreed (one ran 5.4×
 * slower), so Safari is not shown for samba."
 */
export function withheldNote(items: readonly WithheldItem[]): string {
  const byBrowser = new Map<string, WithheldItem[]>();
  for (const w of items) {
    byBrowser.set(browserName(w), [...(byBrowser.get(browserName(w)) ?? []), w]);
  }
  return [...byBrowser.entries()]
    .map(([name, ws]) => {
      const inputs = ws.flatMap((w) => (w.input ? [w.input] : []));
      const n = Math.max(...ws.map((w) => w.captures ?? 2));
      const of = inputs.length ? ` of ${listText(inputs)}` : "";
      const worst = ws.reduce((a, b) => (Math.abs(Math.log(b.factor)) > Math.abs(Math.log(a.factor)) ? b : a));
      const slower = Math.max(worst.factor, 1 / worst.factor);
      const why =
        slower > 1.25
          ? `one ran ${ws.length > 1 ? "up to " : ""}${times(slower)} slower`
          : `${pct(Math.max(...ws.map((w) => w.outliers)))} of series moved by more than 1.5×`;
      const where = inputs.length ? ` for ${listText(inputs)}` : "";
      return `${name}'s ${n === 2 ? "two" : countWord(n)} captures${of} disagreed (${why}), so ${name} is not shown${where}.`;
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/**
 * Non-breaking hyphens (U+2011) inside names, so "wasm-opt", "zlib-rs",
 * "bump-scope" or "-O3" never break across lines in a title. Only hyphens
 * between word characters, or before one at a word start, change; dashes
 * and minus signs are left alone. Underscores ("lz4_flex") already hold.
 */
export const nb = (text: string) => text.replace(/(^|[\w\s(])-(?=\w)/g, (_m, before: string) => `${before}\u2011`);
