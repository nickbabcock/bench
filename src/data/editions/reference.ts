/**
 * A page's reference data, shared by Allocation, Memory64 and Build: every
 * capture of the latest edition, one setting per engine and machine, the
 * reference machine in Chrome first. Each page maps a capture and its
 * repeats to its own setting (`referenceOf`); the run-per-capture pages
 * share one setting shape (`runSetting`).
 */
import { type BrowserId, capturePath, type Edition } from "@/lib/edition";
import { type MachineRef, withheldNote } from "@/lib/findings";
import { latestEditionId, select, withheld } from "./index";

/** The reference machine and browser every page opens on. */
export const REFERENCE_MACHINE = "m4pro-arm64";
export const REFERENCE_BROWSER: BrowserId = "chrome";

/** Browsers in a fixed order, so settings never reorder. */
const BROWSERS = ["chrome", "firefox", "safari"] as const;
const browserNames: Record<BrowserId, string> = { chrome: "Chrome", firefox: "Firefox", safari: "Safari" };

/** "Chrome 156". */
export const engineName = (e: Edition) => `${e.browser.name} ${e.browser.version.split(".")[0]}`;

export const machineRef = (e: Edition): MachineRef => ({ id: e.machine.id, cpuModel: e.machine.cpuModel, arch: e.machine.arch });

/**
 * A capture's raw-JSON URL, looked up in a page's own `import.meta.glob`
 * of its captures as URLs (the glob is a literal in each page under
 * src/features, so a page emits only its own benchmark's files).
 */
export const rawUrlIn = (urls: Record<string, string>) => (e: Edition) => urls[`../../data/editions/${capturePath(e)}`];

export type ReferenceOf<S> = {
  /** "2026-11-08". */
  editionId: string;
  /** Every setting in the edition, the default (reference machine, Chrome) first. */
  settings: S[];
  /** Engines with no capture in this edition ("Safari"), for the notes. */
  unmeasured: string[];
  /** The drift gate's sentence on engines whose two captures disagreed, or "". */
  withheldNote: string;
};

/**
 * The latest edition's settings, each primary capture mapped with its
 * replicates by `setting`: the reference machine first, then by browser
 * and machine. With every setting withheld by the drift gate, no settings,
 * only the note why. `undefined` when there are no captures at all.
 */
export function referenceOf<E extends Edition, S>(all: readonly E[], setting: (e: E, replicates: E[]) => S): ReferenceOf<S> | undefined {
  const { primary } = select(all, {});
  const latest = latestEditionId(all);
  if (latest === undefined) {
    return undefined;
  }
  if (primary.length === 0) {
    return { editionId: latest, settings: [], unmeasured: [], withheldNote: withheldNote(withheld(all, { edition: latest })) };
  }
  const editionId = primary[0].id;
  const rank = (e: E) => (e.machine.id === REFERENCE_MACHINE ? 0 : 10) + BROWSERS.indexOf(e.browser.id as BrowserId);
  const sorted = [...primary].sort((a, b) => rank(a) - rank(b) || a.machine.id.localeCompare(b.machine.id));
  const held = withheld(all, { edition: editionId });
  // A browser the drift gate withheld was measured: it is named in the withheld note, not as "not measured".
  const measured = new Set([...primary.map((e) => e.browser.id), ...held.map((w) => w.browser)]);
  return {
    editionId,
    settings: sorted.map((e) => setting(e, select(all, { edition: editionId, machine: e.machine.id, browser: e.browser.id as BrowserId, input: e.input }).replicates)),
    unmeasured: BROWSERS.filter((b) => !measured.has(b)).map((b) => browserNames[b]),
    withheldNote: withheldNote(held),
  };
}

/** One reference setting (an engine on a machine) of a benchmark with one run per capture. */
export type RunSetting<E extends Edition> = {
  /** "Chrome 156". */
  engine: string;
  /** "Chrome". */
  browser: string;
  machine: MachineRef;
  run: E["raw"];
  /** Independent repeats of the same capture, for the reproduction gate. */
  replicates: E["raw"][];
  /** The capture itself. */
  edition: E;
  rawHref: string;
};

export const runSetting = <E extends Edition>(e: E, replicates: readonly E[], rawUrl: (e: Edition) => string): RunSetting<E> => ({
  engine: engineName(e),
  browser: e.browser.name,
  machine: machineRef(e),
  run: e.raw,
  replicates: replicates.map((r) => r.raw),
  edition: e,
  rawHref: rawUrl(e),
});
