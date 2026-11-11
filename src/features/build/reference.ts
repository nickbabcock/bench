/**
 * The reference data for this page (src/data/editions/reference.ts):
 * every capture of the latest edition, one setting per engine and
 * machine. Captures come from scripts/capture.mjs --bench build.
 */
import type { BuildEdition } from "@/data/editions";
import { buildCaptures } from "@/data/editions/build";
import { engineName, machineRef, rawUrlIn, referenceOf, type ReferenceOf } from "@/data/editions/reference";
import type { BrowserId } from "@/lib/edition";
import type { MachineRef } from "@/lib/findings";
import type { ResultRow } from "./harness";

/** Same-origin URLs of every capture's raw JSON, emitted as static assets. */
const rawUrl = rawUrlIn(import.meta.glob<string>("../../data/editions/build/*/*/*.json", { query: "?url&no-inline", import: "default", eager: true }));

/** One reference setting (an engine on a machine). */
export type Setting = {
  /** "chrome@m4pro-arm64". */
  id: string;
  /** "Chrome 156". */
  engine: string;
  browser: BrowserId;
  machine: MachineRef;
  /** The rows of repeat 1. */
  rows: ResultRow[];
  /** The same, for each further repeat. */
  repeats: ResultRow[][];
  edition: BuildEdition;
  /** Every capture of this setting, repeat 1 first. */
  captures: { edition: BuildEdition; href: string }[];
};

export type Reference = ReferenceOf<Setting>;

function fromEditions(all: readonly BuildEdition[]): Reference | undefined {
  const ref = referenceOf(all, (e, replicates): Setting => ({
    id: `${e.browser.id}@${e.machine.id}`,
    engine: engineName(e),
    browser: e.browser.id as BrowserId,
    machine: machineRef(e),
    rows: e.raw,
    repeats: replicates.map((r) => r.raw),
    edition: e,
    captures: [e, ...replicates].map((x) => ({ edition: x, href: rawUrl(x) })),
  }));
  return ref?.settings.length ? ref : undefined;
}

// referenceOf leaves out settings the drift gate withholds; with every one withheld there is nothing to show.
const missing = (): never => {
  throw new Error("No admitted build reference capture under src/data/editions/build/ (none captured, or every setting withheld by the drift gate)");
};

let cached: Reference | undefined;
export const reference = (): Reference => (cached ??= fromEditions(buildCaptures()) ?? missing());
