/**
 * Reference captures: shared helpers (selection, facets, the drift gate).
 * The data itself lives behind one module per benchmark
 * (./compression.ts, ./allocation.ts, ./memory64.ts, ./build.ts), each
 * with its own eager glob, so a page bundles only its own benchmark's
 * captures. This module imports no data. Paths and shapes:
 * src/lib/edition.ts.
 */
import { type BenchId, type BrowserId, driftFails, type Edition, repeatDrift } from "@/lib/edition";
import type { CompressionRun } from "@/features/compression/types";
import type { AllocationRun } from "@/features/allocation/harness";
import type { ResultRow as Memory64Row } from "@/features/memory64/harness";
import type { ResultRow as BuildRow } from "@/features/build/harness";

export type CompressionEdition = Edition<CompressionRun>;
export type AllocationEdition = Edition<AllocationRun>;
export type Memory64Edition = Edition<Memory64Row>;
export type BuildEdition = Edition<BuildRow[]>;

/** Each benchmark's captures, once loaded, so `withheld(bench)` can find them. */
const loaded = new Map<BenchId, readonly Edition[]>();

/**
 * A benchmark's captures from its eager glob, the same array on every
 * call. Used by the per-benchmark modules (./compression.ts, …), each of
 * which holds its own literal glob, so a page bundles only its own data.
 */
export function loadCaptures<E extends Edition>(bench: BenchId, glob: () => Record<string, E>): readonly E[] {
  let all = loaded.get(bench) as readonly E[] | undefined;
  if (!all) {
    all = Object.values(glob());
    loaded.set(bench, all);
  }
  return all;
}

/** The newest edition id among captures. */
export const latestEditionId = (all: readonly Edition[]) => [...new Set(all.map((e) => e.id))].sort().at(-1);

export type Selection = {
  edition?: string;
  machine?: string;
  browser?: BrowserId;
  input?: string | null;
  /** Also return captures the drift gate withholds (raw-data links, diagnostics). Default false. */
  includeWithheld?: boolean;
};

// ---------------------------------------------------------------------------
// The drift gate. Two independent captures of one setting (edition,
// machine, browser, input) must agree, by the rule scripts/capture.mjs
// applies when it writes them (`repeatDrift`, `driftFails` in
// src/lib/edition.ts): the geometric mean of matched median ratios within
// 1/1.25–1.25, and at most 5% of series moved by more than 1.5×. When they
// don't, one of them ran in a slowed state (automated Safari, for one, can
// be scheduled at background priority), so that setting is withheld
// everywhere: `select` returns nothing for it and `facets` doesn't offer
// it. Computed from `raw`, never from a capture's stored `repeatDrift`.
// ---------------------------------------------------------------------------

/** One withheld setting: the browser (and input) whose captures disagree. */
export type Withheld = {
  browser: BrowserId;
  /** The browser's display name, "Safari". */
  name: string;
  /** Absent for benchmarks without inputs. */
  input?: string;
  edition: string;
  machine: string;
  /** The primary capture's medians over the disagreeing replicate's (geometric mean); 5.4 means the primary ran 5.4× slower. */
  factor: number;
  /** Share of series whose medians moved by more than 1.5×. */
  outliers: number;
  /** How many independent captures the setting has. */
  captures: number;
};

const settingKey = (e: Edition) => `${e.id}\u0000${e.machine.id}\u0000${e.browser.id}\u0000${e.input ?? ""}`;

const driftCache = new WeakMap<readonly Edition[], { withheld: Withheld[]; captures: WeakSet<Edition> }>();

/** The settings among `all` whose repeats disagree, and every capture of them. */
function drift(all: readonly Edition[]) {
  const hit = driftCache.get(all);
  if (hit) {
    return hit;
  }
  const groups = new Map<string, Edition[]>();
  for (const e of all) {
    groups.set(settingKey(e), [...(groups.get(settingKey(e)) ?? []), e]);
  }
  const items: Withheld[] = [];
  const held = new WeakSet<Edition>();
  for (const group of groups.values()) {
    const primary = group.find((e) => e.repeat.index === 1);
    if (!primary) {
      continue;
    }
    // The worst-disagreeing replicate decides.
    let worst: { factor: number; outliers: number } | undefined;
    for (const r of group) {
      if (r === primary) {
        continue;
      }
      const d = repeatDrift(primary.raw, r.raw);
      if (driftFails(d) && (!worst || Math.abs(Math.log(d.factor)) > Math.abs(Math.log(worst.factor)))) {
        worst = d;
      }
    }
    if (worst) {
      for (const e of group) {
        held.add(e);
      }
      items.push({
        browser: primary.browser.id as BrowserId,
        name: primary.browser.name,
        ...(primary.input === null ? {} : { input: primary.input }),
        edition: primary.id,
        machine: primary.machine.id,
        factor: worst.factor,
        outliers: worst.outliers,
        captures: group.length,
      });
    }
  }
  const out = { withheld: items, captures: held };
  driftCache.set(all, out);
  return out;
}

/** `all` without the captures the drift gate withholds. Same array back when nothing is withheld. */
export function admitted<E extends Edition>(all: readonly E[]): readonly E[] {
  const d = drift(all);
  return d.withheld.length ? all.filter((e) => !d.captures.has(e)) : all;
}

/**
 * The settings of a benchmark withheld because their two captures
 * disagree, in the latest edition unless a selection says otherwise
 * (machine, browser, input narrow it). Pass the bench once its captures
 * are loaded (`<bench>Captures()` from ./<bench>.ts), or the captures themselves. Render with `withheldNote`
 * (src/lib/findings.ts): "Safari's two captures of samba disagreed (one
 * ran 5.4× slower), so Safari is not shown for samba."
 */
export function withheld(bench: BenchId | readonly Edition[], s: Omit<Selection, "includeWithheld"> = {}): Withheld[] {
  const all = typeof bench === "string" ? loaded.get(bench) : bench;
  if (!all) {
    throw new Error(`withheld("${bench}"): load its captures first (src/data/editions/${bench}.ts), or pass them`);
  }
  const edition = s.edition ?? latestEditionId(all);
  return drift(all).withheld.filter(
    (w) =>
      w.edition === edition &&
      (s.machine === undefined || w.machine === s.machine) &&
      (s.browser === undefined || w.browser === s.browser) &&
      (s.input === undefined || (w.input ?? null) === s.input),
  );
}

/**
 * The captures matching a selection, split into the primary (repeat 1,
 * shown on the page) and its replicates (for the reproduction gate).
 * Settings the drift gate withholds return nothing, unless
 * `includeWithheld` is set.
 */
export function select<E extends Edition>(all: readonly E[], s: Selection) {
  const edition = s.edition ?? latestEditionId(all);
  const pool = s.includeWithheld ? all : admitted(all);
  const matches = pool.filter(
    (e) =>
      e.id === edition &&
      (s.machine === undefined || e.machine.id === s.machine) &&
      (s.browser === undefined || e.browser.id === s.browser) &&
      (s.input === undefined || e.input === s.input),
  );
  const sorted = [...matches].sort((a, b) => a.repeat.index - b.repeat.index);
  return { primary: sorted.filter((e) => e.repeat.index === 1), replicates: sorted.filter((e) => e.repeat.index > 1) };
}

/**
 * Distinct values present in a set of captures (for input, browser and
 * machine switches), leaving out withheld settings: a browser or input
 * appears only while some admitted capture has it.
 */
export const facets = (all: readonly Edition[]) => {
  const pool = admitted(all);
  return {
    editions: [...new Set(pool.map((e) => e.id))].sort(),
    machines: [...new Map(pool.map((e) => [e.machine.id, e.machine])).values()],
    browsers: [...new Set(pool.map((e) => e.browser.id))],
    inputs: [...new Set(pool.map((e) => e.input).filter((i): i is string => i !== null))],
  };
};
