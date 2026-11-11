/**
 * The Compression release's data: reference captures as cells, and
 * the findings for whatever the page shows.
 */
import { admitted, type CompressionEdition, facets, select } from "@/data/editions";
import { compressionCaptures } from "@/data/editions/compression";
import { REFERENCE_BROWSER, REFERENCE_MACHINE } from "@/data/editions/reference";
import type { BrowserId } from "@/lib/edition";
import { ask, askReproduced, type Finding, type MachineRef } from "@/lib/findings";
import { type FormatId, multiImplementationFormats } from "./codecs";
import { askJoint, cellLines, type CompressionCell, compressionQuestions, figurePlan } from "./findings";
import { type EditionCell, type EditionPoint, editionPoints, type EngineGroup } from "./points";
import { resultRows } from "./results";
import { type Band, bandsOf, type Line, type Scenario } from "./transfer";
import type { CompressionRun } from "./types";

export { REFERENCE_BROWSER, REFERENCE_MACHINE };

/** Formats with a choice of implementation: the page's second decision, one block each. */
export const IMPL_FORMATS: readonly FormatId[] = multiImplementationFormats();
/** The page's figure numbers. */
export const FIGURES = figurePlan(IMPL_FORMATS);
export const QUESTIONS = compressionQuestions(IMPL_FORMATS);

/** Every format-comparison capture, bundled at build time. */
export const allCaptures: readonly CompressionEdition[] = compressionCaptures();
/** The captures the drift gate admits: settings whose two captures disagree are left out everywhere. */
export const shownCaptures: readonly CompressionEdition[] = admitted(allCaptures);

// ---------------------------------------------------------------------------
// Selections and cells
// ---------------------------------------------------------------------------

export const machineRef = (e: Pick<CompressionEdition, "machine">): MachineRef => ({
  id: e.machine.id,
  cpuModel: e.machine.cpuModel,
  arch: e.machine.arch,
});

/** One setting's captures. */
export type RefSel = {
  primary?: CompressionEdition;
  replicates: readonly CompressionEdition[];
};

/** The captures for an input, engine and machine. */
export function reference(input: string, browser: string, machine: string, edition?: string): RefSel {
  const { primary, replicates } = select(allCaptures, { edition, machine, browser: browser as BrowserId, input });
  const p = primary[0];
  if (!p) {
    return { replicates: [] };
  }
  return { primary: p, replicates };
}

/** One capture as a cell. */
export const cellOf = (e: CompressionEdition): CompressionCell => ({
  engine: e.browser.name,
  machine: machineRef(e),
  input: e.input,
  rows: resultRows(e.raw),
});

/** A visitor's run as a cell, scoped to this machine. */
export const mineCell = (run: CompressionRun, engine: string): CompressionCell => ({
  engine,
  machine: { id: "this-machine", cpuModel: "this machine", arch: "" },
  input: run.synthetic ? run.filename : null,
  rows: resultRows(run),
});

/** Figures whose claim is built from every capture at once (time against bandwidth). */
const JOINT = new Set([FIGURES.download, FIGURES.upload]);

/** The findings for one reference setting, gated on its replicates (each cell must reproduce). */
export const referenceFindings = (sel: RefSel): Finding[] =>
  sel.primary
    ? QUESTIONS.map((q) =>
        (JOINT.has(q.figure) ? askJoint : askReproduced)(
          q,
          [cellOf(sel.primary!)],
          sel.replicates.map((r) => [cellOf(r)]),
        ),
      )
    : [];

/**
 * A visitor's run has no second capture, so its findings are not gated;
 * they are scoped to this machine and to what it measured.
 */
export const mineFindings = (cell: CompressionCell): Finding[] => QUESTIONS.map((q) => ask(q, [cell]));

// ---------------------------------------------------------------------------
// The edition's main points: every input, browser and machine at once
// ---------------------------------------------------------------------------

/** Every admitted setting of an edition (latest by default) as a cell with its replicates. */
export function editionCells(edition?: string): EditionCell[] {
  const f = facets(allCaptures);
  return f.machines.flatMap((m) =>
    f.inputs.flatMap((input) =>
      f.browsers.flatMap((browser) => {
        const sel = reference(input, browser, m.id, edition);
        return sel.primary ? [{ cell: cellOf(sel.primary), replicates: sel.replicates.map((r) => cellOf(r)) }] : [];
      }),
    ),
  );
}

/**
 * Per input and machine, the base engine's captures and every other
 * engine's, for comparing implementations between browsers.
 */
export function engineGroups(base: string = REFERENCE_BROWSER, edition?: string): EngineGroup[] {
  const f = facets(allCaptures);
  return f.machines.flatMap((m) =>
    f.inputs.flatMap((input): EngineGroup[] => {
      const b = reference(input, base, m.id, edition);
      if (!b.primary) {
        return [];
      }
      const others = f.browsers.filter((x) => x !== base).flatMap((x) => {
        const sel = reference(input, x, m.id, edition);
        return sel.primary ? [{ sel, name: sel.primary.browser.name }] : [];
      });
      const capturesOf = (x: RefSel) => [x.primary!, ...x.replicates].map((e) => cellOf(e));
      return [
        {
          input,
          machine: m.id,
          base: { engine: b.primary.browser.name, captures: capturesOf(b) },
          others: others.map((o) => ({ engine: o.name, captures: capturesOf(o.sel) })),
        },
      ];
    }),
  );
}

let pointsCache: EditionPoint[] | undefined;

/**
 * The edition's main points (at most four, in figure order). They read
 * every input, browser and machine, so no switch changes them.
 */
export function editionSummary(): { points: EditionPoint[] } {
  pointsCache ??= editionPoints(editionCells(), engineGroups(), FIGURES);
  return { points: pointsCache };
}

// ---------------------------------------------------------------------------
// Across inputs and browsers: one strip per setting
// ---------------------------------------------------------------------------

/** One input in one browser, for the bandwidth maps: its gated bands and every capture's lines. */
export type Strip = {
  id: string;
  input: string;
  engine: string;
  bands: Band[];
  /** Each capture's lines (the first is the one shown), for the winner's lead. */
  captures: Line[][];
};

/** A cell's strip: bands gated on every capture given. */
export function stripOf(cell: CompressionCell, replicates: readonly CompressionCell[], scenario: Scenario, gated = true): Strip {
  const captures = cellLines(
    cell,
    scenario,
    replicates.map((r) => [r]),
  );
  return {
    id: `${cell.input}/${cell.engine}`,
    input: cell.input ?? "",
    engine: cell.engine,
    bands: gated ? bandsOf(captures) : [],
    captures,
  };
}

/** Every input and browser of the edition on one machine, inputs in page order and browsers within each. */
export function editionStrips(scenario: Scenario, machine: string = REFERENCE_MACHINE, edition?: string): Strip[] {
  return editionCells(edition)
    .filter((c) => c.cell.machine.id === machine)
    .map((c) => stripOf(c.cell, c.replicates, scenario));
}
