import { clsx } from "clsx";
import { useState } from "react";
import { DotRange, EffectPlot, type EffectRow, Legend, ratioPercent } from "@/components/charts";
import { ExportButtons } from "@/components/ExportButtons";
import { integerError, NumberInput, numberFieldClass } from "@/components/Field";
import {
  ChoiceChips,
  Cited as CitedText,
  type Column,
  conditionsNote,
  DataTable,
  DatasetSwitch,
  editionProvenance,
  Figure,
  HighlightScope,
  keepTogether,
  MainPoints,
  type MainPoint,
  MeasureRow,
  MeasureSection,
  MeasurementNotes,
  monthOf,
  ms,
  type NoteItem,
  OtherRunning,
  overallOnly,
  Prose,
  RawDataLink,
  ReleaseBody,
  ReleaseHeader,
  ReleaseNotice,
  ResultsTarget,
  type RunOutcome,
  runDate,
  Section,
  sourceLine,
  THIS_MACHINE,
  useSupport,
} from "@/components/release";
import type { CorpusId } from "@/features/compression/corpora";
import { MIN_SAMPLE_MS } from "@/lib/bench";
import { build, hardware } from "@/lib/build";
import { fileDate, toCSV, toMarkdown } from "@/lib/export";
import { withheld } from "@/data/editions";
import { archLabel, ask, listText, machineLabel, type MachineRef, relativeSentence, relativeTo, withheldNote } from "@/lib/findings";
import { formatInteger, plural } from "@/lib/format";
import { useActiveRun } from "@/lib/runRegistry";
import { isPairedClaim, MIN_PAIRED_ROUNDS, summarize } from "@/lib/stats";
import {
  aaEffect,
  aaFails,
  aaPooled,
  aaTitle,
  baselineSpeeds,
  type BuildCell,
  buildCells,
  cellBiased,
  cellClaim,
  informativeRows,
  interactionNote,
  o3Sentence,
  rowKey,
  simdInteraction,
  simdSizeSentence,
  simdSpeed,
  skipWasmOptSpeed,
  unreproduced,
  wasmOptSize,
} from "./findings";
import type { ResultRow } from "./harness";
import { BUILD_CORPORA } from "./input";
import { REFERENCE_MACHINE } from "@/data/editions/reference";
import { reference, type Setting } from "./reference";
import { againstBaseline, contrast, contrastById, rowLabel } from "./results";
import { cancelRun, planFor, selectRun, setCorpora, setDataset, setSampleCount, setSubjects, startRun, useBuildSession } from "./session";
import { type SizeBarRow, SizeBars } from "./SizeBars";
import {
  AA,
  type ArtifactId,
  artifactIds,
  BASELINE,
  type Crate,
  crateLabels,
  manifests,
  type Opt,
  opts,
  type SubjectKey,
  subjectKeys,
  subjects,
  type VariantId,
  variantIds,
} from "./subjects";

const MAX_SAMPLES = 100;
/** Every variant but the baseline, in table order, the A/A last. */
const OTHERS: VariantId[] = [...artifactIds.filter((v) => v !== BASELINE), AA];
const SPEED_TABLE = "build-table-1";
const SIZE_TABLE = "build-table-2";
/** Figures in page order: the SIMD headline first (the owner's direction), then wasm-opt. */
const SIMD_FIGURE = 1;
const SKIP_FIGURE = 2;
const SIZE_FIGURE = 3;
const AA_FIGURE = 4;
const COMPARE_FIGURE = 5;
/** The libraries this page's workloads run (keys of the edition's crate list). */
const LIBRARIES = ["zstd", "zlib-rs", "lz4_flex", "brotli"];

/** A minimal module using one simd128 instruction: validates only where SIMD is supported. */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const simdSupported = () => typeof WebAssembly !== "undefined" && WebAssembly.validate(SIMD_PROBE);

/** Rows in page order: workload, then input. */
const order = (r: ResultRow) => subjectKeys.indexOf(r.subject) * 10 + Math.max(0, BUILD_CORPORA.indexOf(r.input.name as CorpusId));
const sortRows = <T extends ResultRow>(rows: readonly T[]) => [...rows].sort((a, b) => order(a) - order(b));
const inputName = (r: ResultRow) => (r.subject === "alloc" ? "xml" : r.input.name);

/** A generated sentence with every "(Figure n)" and "(Table n)" in it linked (the shared `Cited`). */
const Cited = ({ text }: { text: string }) => <CitedText text={text} tableHref={(n) => `#build-table-${n}`} />;

/** One facet of an effect figure: an engine on a machine, or this machine. */
type Facet = { id: string; title: string; machine: MachineRef; cells: BuildCell[] };

/** A workload's label where its width is fixed (figure rows, Table 1's first column): short enough for one line. */
const shortLabel = (k: SubjectKey) => (k === "alloc" ? "XML (dlmalloc)" : subjects[k].label);

/** A one-row annotation, set under its row in one facet only. */
type RowNote = { key: string; facet: string; text: string };

/**
 * Rows of an effect figure for one contrast, across facets, keyed like the
 * table: only `shown` rows (see `informativeRows`), in page order.
 */
function effectRows(facets: readonly Facet[], contrastId: string, shown: ReadonlySet<string>, note?: RowNote): EffectRow[] {
  const c = contrastById(contrastId)!;
  const rows = sortRows([...new Map(facets.flatMap((f) => f.cells.map((cell) => [rowKey(cell.row), cell.row] as const))).values()]).filter((r) =>
    shown.has(rowKey(r)),
  );
  // The workload names its first row only, like the tables, so no row is spent on a group heading.
  return rows.map((r, i) => ({
    // Also the text tooltips and screen readers read.
    id: `${subjects[r.subject].label} · ${inputName(r)}`,
    key: rowKey(r),
    label: (
      <>
        <span className="inline-block w-[124px] font-semibold">{i === 0 || rows[i - 1].subject !== r.subject ? shortLabel(r.subject) : "\u00a0"}</span>
        <span className="text-ink-2">{inputName(r)}</span>
      </>
    ),
    note: note?.key === rowKey(r) ? note.text : undefined,
    noteFacet: note?.key === rowKey(r) ? note.facet : undefined,
    cells: Object.fromEntries(
      facets.map((f) => {
        const cell = f.cells.find((x) => rowKey(x.row) === rowKey(r));
        const e = cell ? contrast(cell.row, c).effect : undefined;
        return [
          f.id,
          cell && e?.ci
            ? { median: e.median, ci: [e.ci.lo, e.ci.hi] as const, range: [e.min, e.max] as const, claimed: isPairedClaim(cellClaim(cell, contrastId)), n: e.n }
            : undefined,
        ];
      }),
    ),
  }));
}

const machineText = (m: MachineRef) => `${m.cpuModel} (${archLabel(m.arch)})`;
const otherArch = (m: MachineRef) => (archLabel(m.arch) === "arm64" ? "x86-64" : archLabel(m.arch) === "x86-64" ? "arm64" : "other processors");

/** What to try after an error, by its kind. */
const recovery = (error: string) =>
  /memory|grow|unreachable|alloc/i.test(error)
    ? "it likely ran out of Wasm memory"
    : /worker|import|fetch|load|compile|instantiate|variants/i.test(error)
      ? "a build or its worker failed to load"
      : undefined;

const utcDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const utcTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
/** "40 seconds", "12 minutes", "3 hours": a gap between two captures, rounded. */
const gapText = (gap: number) =>
  gap < 90_000 ? plural(Math.max(1, Math.round(gap / 10_000) * 10), "second") : gap < 90 * 60_000 ? plural(Math.round(gap / 60_000), "minute") : plural(Math.round(gap / 3_600_000), "hour");

/**
 * The Measurement notes' disclosure of workloads recaptured after the
 * edition and merged in (each capture's `merged`): what, when, and how far
 * apart its repeats ran. Repeats taken minutes apart in one session are
 * back-to-back, not independent, and the note says so.
 */
function mergedText(settings: readonly Setting[]): { text: string; backToBack: SubjectKey[] } | undefined {
  const groups = new Map<string, { subjects: SubjectKey[]; starts: number[]; ends: number[]; gaps: number[]; engines: Set<string> }>();
  for (const s of settings) {
    const byKey = new Map<string, number[]>();
    for (const c of s.captures) {
      for (const m of c.edition.merged ?? []) {
        const subjectsHere = (m.subjects as SubjectKey[]).filter((k) => subjectKeys.includes(k));
        if (subjectsHere.length === 0) {
          continue;
        }
        const key = [...subjectsHere].sort().join("+");
        const g = groups.get(key) ?? { subjects: subjectsHere, starts: [], ends: [], gaps: [], engines: new Set<string>() };
        g.starts.push(Date.parse(m.capturedAt));
        g.ends.push(Date.parse(m.endedAt));
        g.engines.add(s.engine.split(" ")[0]);
        groups.set(key, g);
        byKey.set(key, [...(byKey.get(key) ?? []), Date.parse(m.capturedAt)]);
      }
    }
    for (const [key, starts] of byKey) {
      if (starts.length > 1) {
        groups.get(key)!.gaps.push(Math.max(...starts) - Math.min(...starts));
      }
    }
  }
  if (groups.size === 0) {
    return undefined;
  }
  const backToBack = [...groups.values()].filter((g) => g.gaps.length > 0 && Math.max(...g.ends) - Math.min(...g.starts) < 60 * 60_000).flatMap((g) => g.subjects);
  const text = [...groups.values()]
    .map((g) => {
      const from = Math.min(...g.starts);
      const to = Math.max(...g.ends);
      const names = listText(g.subjects.map((k) => subjects[k].label));
      const when = `${utcDay.format(from)}, ${utcTime.format(from)}–${utcTime.format(to)} UTC`;
      const lead = `${names} ${g.subjects.length === 1 ? "was" : "were"} recaptured on ${when}, in ${listText([...g.engines])}, and replaced the original rows.`;
      if (g.gaps.length === 0) {
        return lead;
      }
      const gap = Math.max(...g.gaps);
      // Repeats within one short session are back to back: they show the result is stable, not that it holds across sessions.
      return to - from < 60 * 60_000
        ? `${lead} Its two captures per browser ran back to back in that one session, about ${gapText(gap)} apart, so their agreement shows back-to-back reproduction, not independent sessions.`
        : `${lead} Its captures per browser ran up to ${gapText(gap)} apart.`;
    })
    .join(" ");
  return { text, backToBack };
}

/** a's change against b, in percent: −5.5 is 5.5% smaller. */
const changePct = (a: number, b: number) => (a / b - 1) * 100;

export const Build = () => {
  const ref = reference();
  const session = useBuildSession();
  const { results } = session;

  // This machine: the chosen run (newest by default). The session switches to it as rows arrive, even off this page.
  const runs = [...new Set(results.map((r) => r.run ?? 0))];
  const mineRun = session.selected !== null && runs.includes(session.selected) ? session.selected : runs[0];
  const mineRows = sortRows(results.filter((r) => (r.run ?? 0) === mineRun));
  const showMine = session.dataset === "mine" && mineRows.length > 0;
  const tone = showMine ? "mine" : "accent";
  const mineBrowser = mineRows[0]?.context?.browser ?? "This browser";
  const mineEngine = `${mineBrowser} on this machine`;

  // Facets: every engine for the reference; this machine alone for a run.
  const facets: Facet[] = showMine
    ? [{ id: "mine", title: mineEngine, machine: THIS_MACHINE, cells: buildCells(mineRows, mineEngine, THIS_MACHINE) }]
    : ref.settings.map((s) => ({ id: s.id, title: s.engine, machine: s.machine, cells: buildCells(s.rows, s.edition.browser.name, s.machine, s.repeats) }));
  const cells = facets.flatMap((f) => f.cells.filter((c) => c.row.checksumsMatch));

  // Findings: one fixed question per figure, plus -O3 in one sentence.
  const size = ask(wasmOptSize, manifests);
  const simdF = ask(simdSpeed, cells);
  const skipF = ask(skipWasmOptSpeed, cells);
  const o3Text = o3Sentence(cells);
  const interaction = simdInteraction(cells);
  const held = withheldNote(withheld("build"));
  const pendingSimd = unreproduced(cells, "simd@Os");
  const pendingSkip = unreproduced(cells, "skip-wasm-opt@off");
  const simdSize = simdSizeSentence(manifests);

  const base = ref.settings[0];

  // This machine against the reference: the same engine where the reference has it.
  const refForMine = ref.settings.find((s) => s.machine.id === REFERENCE_MACHINE && s.edition.browser.name === mineBrowser.split(" ")[0]) ?? base;
  const confounded = showMine && mineBrowser.split(" ")[0] !== refForMine.edition.browser.name;
  const rel = showMine ? relativeTo(baselineSpeeds(refForMine.rows), baselineSpeeds(mineRows.filter((r) => r.checksumsMatch))) : undefined;

  // At most three points: SIMD first. Sizes don't depend on the machine, so This machine swaps them for its comparison.
  const points: MainPoint[] = [simdF, skipF, ...(rel ? [] : [size])].filter((f) => f.claim).map((f) => ({ id: f.claim!.key, text: <Cited text={f.claim!.text} /> }));
  if (rel) {
    const sentence = relativeSentence(rel, "This machine", `${refForMine.engine} on the ${refForMine.machine.cpuModel}`, "row");
    // The overall figure only: the geometric mean and range are Figure 5's, so the point carries one citation.
    points.push({ id: "relative", text: <Cited text={`${overallOnly(sentence)} (Figure ${COMPARE_FIGURE}).`} /> });
  }

  const n = showMine ? (mineRows[0]?.samples[BASELINE].length ?? 0) : base.edition.method.samples;
  const capturesEach = base.captures.length;
  // Workloads recaptured in one short session: their repeats are back to back, so the Source line doesn't call them independent.
  const merge = mergedText(ref.settings);
  const mergeNote = merge?.text;
  const backToBack = merge?.backToBack ?? [];
  const editionMonth = monthOf(ref.editionId);
  const mineDate = mineRows[0] ? runDate(mineRows[0].startedAt) : "";
  // The Measurement notes line: the page's one statement of its source.
  const samplesText = `${n} rounds per row, ${capturesEach === 2 ? "two independent captures" : plural(capturesEach, "capture")} each`;
  const provenance = [
    ...editionProvenance(base.edition, { browsers: listText(ref.settings.map((s) => s.engine)), samples: samplesText }),
    ...(backToBack.length ? [`${listText(backToBack.map(shortLabel))} captured back to back`] : []),
  ];

  const sections = [
    { id: "points", title: "Main points" },
    { id: "simd", title: "SIMD and speed" },
    { id: "skip", title: "wasm-opt and speed" },
    { id: "size", title: "wasm-opt, SIMD and download size" },
    { id: "aa", title: "The A/A control" },
    ...(rel ? [{ id: "compare", title: "Against the reference" }] : []),
    { id: "table", title: "All configurations" },
    { id: "measure", title: "Measure on this machine" },
  ];

  const legend = (
    <Legend
      items={[
        { mark: { kind: "dot", tone }, label: showMine ? "Claimed" : "Claimed in both captures" },
        { mark: { kind: "dot", tone: "grey" }, label: "Not claimed" },
        { mark: { kind: "whisker", tone: "grey" }, label: "95% CI" },
        { mark: { kind: "faint" }, label: "Min–max" },
        { mark: { kind: "band" }, label: "±3% threshold" },
      ]}
    />
  );
  const effectFigure = (contrastId: string, label: string, shown: ReadonlySet<string>, note?: RowNote) => (
    <EffectPlot
      rows={effectRows(facets, contrastId, shown, note)}
      facets={facets.map((f) => ({ id: f.id, title: f.title }))}
      label={label}
      tone={tone}
      tableId={SPEED_TABLE}
      labelWidth={200}
    />
  );
  // Each speed figure shows its informative rows (a claim, or browsers that differ); the rest are in Table 1.
  const allRowKeys = new Set(cells.map((c) => rowKey(c.row)));
  const shownRows = (contrastId: string, extra?: string) => {
    const keys = informativeRows(cells, contrastId);
    if (extra) {
      keys.add(extra);
    }
    return keys.size === 0 || (showMine && allRowKeys.size <= 12) ? allRowKeys : keys;
  };
  const interactionRow: RowNote | undefined = interaction
    ? { key: rowKey(interaction.cell.row), facet: facets.find((f) => f.cells.includes(interaction.cell))?.id ?? "", text: interactionNote(interaction) }
    : undefined;
  const simdRows = shownRows("simd@Os", interactionRow?.key);
  const skipRows = shownRows("skip-wasm-opt@off");
  const tableOnly = (shown: ReadonlySet<string>) => {
    const hidden = allRowKeys.size - shown.size;
    return hidden > 0 ? `${hidden} of ${allRowKeys.size} rows, with no claim${showMine ? "" : " and browsers agreeing"}, are in Table 1 only.` : "";
  };
  // A/A-failed cells in a figure's rows, by engine: "zstd decode in Safari".
  const biasedNote = (shown: ReadonlySet<string>) => {
    const byEngine = new Map<string, Set<string>>();
    for (const c of cells.filter((x) => cellBiased(x) && shown.has(rowKey(x.row)))) {
      byEngine.set(c.engine, (byEngine.get(c.engine) ?? new Set()).add(subjects[c.row.subject].label));
    }
    const names = [...byEngine].map(([engine, labels]) => `${listText([...labels])} in ${engine}`);
    return names.length ? `${listText(names)}: A/A control failed, so grey (Figure ${AA_FIGURE}).` : "";
  };
  // Claims one capture made and the other didn't: counted here, listed in Table 1 by capture.
  const pendingText = (xs: BuildCell[]) => (xs.length ? `${plural(xs.length, "claim")} held in one capture only, so not counted.` : "");
  const figureNotes = (...xs: string[]) => {
    const text = xs.filter(Boolean).join(" ");
    return text ? keepTogether(text) : undefined;
  };

  // Figure 4: the A/A control, one row per workload, pooled over inputs and captures, per engine and machine.
  const aaRows: EffectRow[] = subjectKeys
    .filter((k) => cells.some((c) => c.row.subject === k))
    .map((k) => {
      const pooled = aaPooled(cells.filter((c) => c.row.subject === k));
      return {
        id: `aa:${k}`,
        key: `aa:${k}`,
        label: shortLabel(k),
        cells: Object.fromEntries(
          facets.map((f) => {
            const p = pooled.find((x) => x.engine === (f.cells[0]?.engine ?? "") && x.machine.id === f.machine.id);
            const e = p?.effect;
            return [f.id, e?.ci ? { median: e.median, ci: [e.ci.lo, e.ci.hi] as const, range: [e.min, e.max] as const, claimed: p!.rejected, n: e.n } : undefined];
          }),
        ),
      };
    });
  // The farthest failed control, labelled with its value under its facet: it can sit past the last tick.
  const aaWorst = aaRows
    .flatMap((r) => facets.flatMap((f) => (r.cells[f.id]?.claimed ? [{ r, f, median: r.cells[f.id]!.median }] : [])))
    .sort((a, b) => Math.abs(Math.log(b.median)) - Math.abs(Math.log(a.median)))[0];
  if (aaWorst) {
    aaWorst.r.note = `${aaWorst.f.title.split(" ")[0]}: ${ratioPercent(aaWorst.median)}, control failed.`;
    aaWorst.r.noteFacet = aaWorst.f.id;
  }
  const aaCaptures = showMine ? 1 : capturesEach;

  // Figure 3: change in brotli bytes per module, as labelled bars.
  const crates = Object.keys(manifests) as Crate[];
  const sizeOrder: Crate[] = ["zstd_read", "zlib_rs", "lz4", "br_write", "alloc"];
  const sizeRows: SizeBarRow[] = sizeOrder
    .filter((c) => crates.includes(c))
    .map((crate) => {
      const m = manifests[crate]!;
      const ch = (a: ArtifactId, b: ArtifactId) =>
        m[a] && m[b] ? { pct: changePct(m[a].bytes.brotli, m[b].bytes.brotli), from: m[b].bytes.brotli, to: m[a].bytes.brotli } : undefined;
      return { id: crate, key: crate, label: crateLabels[crate], values: { os: ch("off-Os", "off-none"), simd: ch("on-Os", "off-Os") } };
    });
  const anyManifest = manifests.zlib_rs?.["on-Os"] ?? Object.values(manifests)[0]?.["on-Os"];

  // Table 1: the full matrix for one setting.
  const [tablePick, setTablePick] = useState(base.id);
  const tableSetting = ref.settings.find((s) => s.id === tablePick) ?? base;
  const tableRows = showMine ? mineRows : sortRows(tableSetting.rows);
  // A row's A/A failed when its control failed in any capture of this setting.
  const tableCaptures = showMine ? [mineRows] : [tableSetting.rows, ...tableSetting.repeats];
  const aaRejected = (r: ResultRow) => tableCaptures.some((rows) => rows.some((x) => rowKey(x) === rowKey(r) && aaFails(x)));
  const matrixColumns: Column<ResultRow>[] = [
    {
      id: "workload",
      header: "Workload · input",
      render: (r, at) => (
        <span className="block whitespace-nowrap">
          <span className="inline-block w-[124px] font-semibold">{at.first ? shortLabel(r.subject) : "\u00a0"}</span>
          <span className="text-ink-2">{inputName(r)}</span>
          {aaRejected(r) ? <small className="ml-2 text-xs font-semibold text-danger">A/A failed</small> : null}
        </span>
      ),
    },
    { id: "base", header: "Shipped, per run", align: "right", render: (r) => ms(summarize(r.samples[BASELINE]).median) },
    ...OTHERS.map(
      (v): Column<ResultRow> => ({
        id: v,
        header: <VariantHead v={v} />,
        align: "right",
        render: (r) => {
          const e = againstBaseline(r)[v];
          const failed = v === AA && aaFails(r);
          return (
            <span className="block whitespace-nowrap">
              <span className={clsx(isPairedClaim(e.claim) && r.checksumsMatch && "font-semibold", failed && "text-danger")}>
                {e.median.toFixed(3)}
                {failed ? " failed" : ""}
              </span>
              <small className="ml-1.5 text-xs text-ink-3">{e.ci ? `${e.ci.lo.toFixed(2)}–${e.ci.hi.toFixed(2)}` : "no CI"}</small>
            </span>
          );
        },
      }),
    ),
    // Only when some row's builds disagreed (those rows are also marked failed).
    ...(tableRows.some((r) => !r.checksumsMatch) ? [{ id: "check", header: "Outputs", render: (r: ResultRow) => (r.checksumsMatch ? "match" : "differ") }] : []),
  ];

  // Table 2: sizes from the manifests, one row per module and SIMD setting, one column per wasm-opt level.
  type SizeLine = { crate: Crate; simd: "off" | "on" };
  const sizeLines: SizeLine[] = sizeOrder
    .filter((c) => crates.includes(c))
    .flatMap((crate) => (["off", "on"] as const).filter((on) => opts.some((o) => manifests[crate]?.[`${on}-${o}`])).map((on) => ({ crate, simd: on })));
  const sizeOf = (l: SizeLine, o: Opt) => manifests[l.crate]?.[`${l.simd}-${o}`];
  const sizeColumns: Column<SizeLine>[] = [
    {
      id: "module",
      header: "Module · SIMD",
      render: (l, at) => (
        <span className="block min-w-[130px]">
          {at.first ? <span className="block font-semibold">{crateLabels[l.crate]}</span> : null}
          <span className="text-ink-2">{l.simd === "on" ? "simd128" : "scalar"}</span>
        </span>
      ),
    },
    ...opts.map(
      (o): Column<SizeLine> => ({
        id: o,
        header: o === "none" ? "No wasm-opt" : `wasm-opt -${o}`,
        align: "right",
        render: (l) => {
          const m = sizeOf(l, o);
          return m ? (
            <span className="block whitespace-nowrap">
              <span className={clsx(l.simd === "off" && o === "Os" && "font-semibold")}>{formatInteger(m.bytes.brotli)}</span>
              <small className="block text-xs text-ink-3">
                {formatInteger(m.bytes.raw)} · {formatInteger(m.bytes.gzip)}
              </small>
            </span>
          ) : (
            "—"
          );
        },
      }),
    ),
    {
      id: "ops",
      header: (
        <span className="block whitespace-nowrap">
          SIMD instructions
          <br />
          none · -Os · -O3
        </span>
      ),
      align: "right",
      render: (l) => opts.map((o) => (sizeOf(l, o) ? formatInteger(sizeOf(l, o)!.simdOps.instructions) : "—")).join(" · "),
    },
  ];

  // Measurement notes: everything inside the closed disclosure.
  const flags = anyManifest?.flags;
  const notes: NoteItem[] = [
    ...(showMine
      ? [conditionsNote(mineRows[0], `${plural(n, "round")} per row, each sample a batch of at least ${MIN_SAMPLE_MS} ms.`)]
      : []),
    {
      term: "Workloads",
      detail: (
        <ul className="space-y-1">
          {subjectKeys.map((k) => (
            <li key={k}>
              <b className="font-semibold text-ink">{subjects[k].label}</b>: {subjects[k].detail}.
            </li>
          ))}
        </ul>
      ),
    },
    {
      term: "Builds",
      detail: (
        <>
          Six builds of each module: simd128 off or on, then no wasm-opt, <code>-Os</code> or <code>-O3</code>. Every one is Rust&apos;s release
          profile ({flags?.profile.replace(/^release: /, "") ?? "opt-level 3"}). SIMD on: <code>{flags?.env.RUSTFLAGS ?? "-C target-feature=+simd128"}</code> and,
          for the C code, <code>{flags?.env.CFLAGS_wasm32_unknown_unknown ?? "-msimd128"}</code>. Then <code>{flags?.wasmBindgen ?? "wasm-bindgen"}</code> and{" "}
          <code>wasm-opt -Os</code> or <code>-O3</code>. The shipped build, which every other page runs, is scalar with <code>wasm-opt -Os</code>.
        </>
      ),
    },
    {
      term: "Pairing",
      detail: `Each round runs all seven variants (the six builds and the A/A instance) in a rotating order, so every comparison is a ratio from the same round.${showMine ? "" : " Figures and main points count a claim only where both captures make it."}`,
    },
    {
      term: "Sizes",
      detail: `Raw bytes of each .wasm after wasm-bindgen and wasm-opt, then gzip level ${anyManifest?.compression.gzipLevel ?? 9} and brotli quality ${anyManifest?.compression.brotliQuality ?? 11} of the same file. Exact, so they need no interval, and the same in every browser. ${simdSize ?? ""} SIMD instructions are a static count.`,
    },
    {
      term: "Mechanism",
      detail: (
        <>
          zlib-rs 0.6.8, <code>src/deflate/compare256.rs</code> (the wasm32 and NEON paths); V8 at commit 63481c19 (7 November 2026), <code>kX64IBitMask</code> in{" "}
          <code>src/compiler/backend/x64/code-generator-x64.cc</code> and <code>MacroAssembler::I8x16BitMask</code> in <code>src/codegen/arm64/macro-assembler-arm64.cc</code>.
          The lowering is V8&apos;s (Chrome); Firefox and Safari compile wasm with their own compilers, not covered here.
        </>
      ),
    },
    ...(!showMine && mergeNote ? [{ term: "Recaptured", detail: mergeNote }] : []),
    ...(!showMine && ref.unmeasured.length ? [{ term: "Not measured", detail: `${listText(ref.unmeasured)}.` }] : []),
    ...(!showMine
      ? [
          {
            term: "Raw data",
            detail: (
              <ul className="space-y-0.5">
                {ref.settings.flatMap((s) =>
                  s.captures.map((c) => (
                    <li key={c.href}>
                      <RawDataLink href={c.href} label={`${s.engine}, ${machineText(s.machine)}, capture ${c.edition.repeat.index} of ${c.edition.repeat.of} (JSON)`} />
                    </li>
                  )),
                )}
              </ul>
            ),
          },
        ]
      : []),
  ];

  // The header's one page-wide caveat: what hasn't been measured.
  const headerNote = `Only the ${machineText(base.machine)} has been measured, not ${otherArch(base.machine)}`;

  return (
    <HighlightScope>
      <ReleaseHeader
        measure
        title={showMine ? <>SIMD and wasm-opt in WebAssembly builds</> : <>SIMD and wasm-opt in WebAssembly builds: {editionMonth}</>}
        meta={[
          showMine
            ? { label: "This machine", value: [hardware().platform, mineRows[0].context?.cores ? `${mineRows[0].context.cores} logical cores` : undefined].filter(Boolean).join(" · ") || "This machine" }
            : { label: "Reference machine", value: machineLabel(base.edition.machine) },
          showMine ? { label: "Browser", value: mineBrowser } : { label: "Browsers", value: listText(ref.settings.filter((s) => s.machine.id === base.machine.id).map((s) => s.engine)) },
          { label: "Samples", value: showMine ? `${n} rounds per row` : `${n} rounds per row, ${capturesEach === 2 ? "two captures" : plural(capturesEach, "capture")}` },
        ]}
        switches={mineRows.length ? <DatasetSwitch value={showMine ? "mine" : "reference"} onChange={setDataset} hasMine /> : undefined}
        notice={
          showMine ? (
            confounded ? (
              <ReleaseNotice>
                This browser isn&apos;t the reference&apos;s ({refForMine.engine}), so engine and machine are confounded in Figure {COMPARE_FIGURE}.
              </ReleaseNotice>
            ) : undefined
          ) : headerNote || held ? (
            <ReleaseNotice>
              {headerNote ? keepTogether(`${headerNote}.`) : null}
              {held ? ` ${held}` : null}
            </ReleaseNotice>
          ) : undefined
        }
      />
      <ReleaseBody sections={sections}>
        <Section id="points">
          <MainPoints tone={tone} points={points} empty="No effect cleared the threshold in this data, so there are no main points." />
        </Section>

        <Section id="simd">
          <Figure
            n={SIMD_FIGURE}
            title={simdF.title}
            subtitle={`simd128 build's time ÷ the scalar build's in the same round, both at wasm-opt -Os; ${plural(n, "round")}. `}
            legend={legend}
            notes={figureNotes(tableOnly(simdRows), biasedNote(simdRows), showMine ? "" : pendingText(pendingSimd))}
          >
            {effectFigure("simd@Os", "simd128 against scalar at wasm-opt -Os, per workload and input", simdRows, interactionRow)}
          </Figure>
          <div className="mt-8 grid gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,68ch)_minmax(0,1fr)]">
            <Prose>
              <h3 className="text-fig font-bold text-ink">Why the processor matters</h3>
              <p>
                zlib-rs&apos;s <code>compare256</code>, deflate&apos;s match-length loop, ends each 16-byte step in <code>i8x16.bitmask</code>, one instruction on
                x86-64 but a sequence on arm64.
              </p>
              <p>
                {otherArch(base.machine) === "x86-64"
                  ? "This may give SIMD a larger gain in zlib-rs deflate on x86-64, which has not been measured here."
                  : `This may give SIMD a larger gain in zlib-rs deflate on x86-64; measured on ${machineText(base.machine)}.`}
              </p>
            </Prose>
            <figure className="min-w-0 self-start">
              <pre className="overflow-x-auto bg-band px-4 py-3 text-[0.8125rem] leading-[1.55] text-ink">
                <code>{MECHANISM}</code>
              </pre>
              <figcaption className="mt-1.5 text-cap text-ink-2">
                <b className="font-semibold text-ink">Source: </b>
                zlib-rs 0.6.8 and V8 at commit 63481c19 (Measurement notes).
              </figcaption>
            </figure>
          </div>
        </Section>

        <Section id="skip">
          <Figure
            n={SKIP_FIGURE}
            title={skipF.title}
            subtitle={`Scalar build without wasm-opt: its time ÷ the shipped build's (wasm-opt -Os) in the same round; ${plural(n, "round")}.`}
            legend={legend}
            notes={figureNotes(tableOnly(skipRows), biasedNote(skipRows), showMine ? "" : pendingText(pendingSkip))}
          >
            {effectFigure("skip-wasm-opt@off", "No wasm-opt against wasm-opt -Os, scalar, per workload and input", skipRows)}
          </Figure>
          <Prose className="mt-6">
            <p>
              <Cited text={o3Text} />
            </p>
          </Prose>
        </Section>

        <Section id="size">
          <Figure
            n={SIZE_FIGURE}
            title={size.title}
            subtitle="Change in brotli-compressed bytes per module; exact and the same in every browser."
            source={`Build manifests of the modules this page runs (scripts/build-variants.ts)${anyManifest ? `. ${anyManifest.toolchain.rustc}; ${anyManifest.toolchain.wasmOpt}` : ""}`}
            notes={
              <>
                Raw and gzip bytes, and the <span className="whitespace-nowrap">-O3</span> builds:{" "}
                <a href={`#${SIZE_TABLE}`} className="link">
                  Table 2
                </a>
                .
              </>
            }
          >
            <SizeBars
              rows={sizeRows}
              panels={[
                { id: "os", title: "wasm-opt -Os vs none (scalar)" },
                { id: "simd", title: "simd128 vs scalar (-Os)", hollow: true },
              ]}
              label="Change in brotli bytes per module: wasm-opt -Os against none, and simd128 against scalar"
              tableId={SIZE_TABLE}
              labelWidth={130}
            />
          </Figure>
        </Section>

        <Section id="aa">
          <Figure
            n={AA_FIGURE}
            title={aaTitle(cells)}
            subtitle={`Time of a second, byte-identical instance of the shipped build ÷ the first's, pooling each workload's inputs${aaCaptures > 1 ? " and both captures" : ""}. Where it fails, nothing is claimed for that workload in that browser.`}
            legend={
              <Legend
                items={[
                  { mark: { kind: "dot", tone }, label: "Control failed" },
                  { mark: { kind: "dot", tone: "grey" }, label: "Passed" },
                  { mark: { kind: "whisker", tone: "grey" }, label: "95% CI" },
                  { mark: { kind: "faint" }, label: "Min–max" },
                  { mark: { kind: "band" }, label: "±3% threshold" },
                ]}
              />
            }
          >
            <EffectPlot
              rows={aaRows}
              facets={facets.map((f) => ({ id: f.id, title: f.title }))}
              label="A/A control: second instance against the first, per workload"
              axisTitle="Second instance's time ÷ the first's (log scale)"
              tone={tone}
              labelWidth={130}
            />
          </Figure>
        </Section>

        {rel ? (
          <Section id="compare">
            <Figure
              n={COMPARE_FIGURE}
              title={`This machine's speed against ${refForMine.engine} on the ${machineText(refForMine.machine)}, per workload`}
              subtitle="This machine's speed ÷ the reference's for the shipped build, over the geometric mean: 1 moved with the rest. Marked points moved beyond ±3%."
              source={`Compared with ${sourceLine(refForMine.edition)}`}
            >
              <DotRange
                rows={Object.keys(rel.normalized)
                  .map((k) => mineRows.find((r) => rowKey(r) === k)!)
                  .map((r) => ({ id: rowKey(r), key: rowKey(r), group: subjects[r.subject].label, label: inputName(r), value: rel.normalized[rowKey(r)], highlight: rel.moved.includes(rowKey(r)) }))}
                tone="mine"
                axis={{ kind: "log", title: "Relative standing (log scale)", format: (v) => `${v.toFixed(3)}×`, tickFormat: (v) => v.toFixed(2), reference: 1, ends: ["fell behind", "pulled ahead"] }}
                label="This machine against the reference, per workload"
                labelWidth={150}
              />
            </Figure>
          </Section>
        ) : null}

        <Section id="table">
          {!showMine && ref.settings.length > 1 ? (
            <div className="mb-4">
              <ChoiceChips
                label="Browser and machine shown in Table 1"
                value={tableSetting.id}
                onChange={setTablePick}
                options={ref.settings.map((s) => ({ value: s.id, label: s.engine }))}
              />
            </div>
          ) : null}
          <DataTable
            id={SPEED_TABLE}
            caption={
              <>
                <b className="font-semibold text-ink">Table 1.</b> Each build&apos;s time ÷ the shipped build&apos;s in the same round (
                {showMine ? "this machine" : `${tableSetting.engine}, capture 1`}): median of {plural(n, "round")} and 95% CI. Bold clears the claim rule
                {showMine ? "" : " in this capture"}.
              </>
            }
            columns={matrixColumns}
            rows={tableRows}
            rowKey={(r) => rowKey(r)}
            group={(r) => r.subject}
            failed={(r) => !r.checksumsMatch}
            tone={tone}
            footnote={
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span>{showMine ? "Export Table 1 for this run:" : "Export Table 1 for every browser and capture (with min–max):"}</span>
                <MatrixExport settings={showMine ? undefined : ref.settings} mine={showMine ? mineRows : undefined} />
              </div>
            }
          />
          <div className="mt-10">
            <DataTable
              id={SIZE_TABLE}
              caption={
                <>
                  <b className="font-semibold text-ink">Table 2.</b> Brotli bytes of each build; under each, raw · gzip. Bold is the shipped build; SIMD
                  instructions are a static count.
                </>
              }
              columns={sizeColumns}
              rows={sizeLines}
              rowKey={(l) => `${l.crate}:${l.simd}`}
              linkKey={(l) => l.crate}
              group={(l) => l.crate}
            />
          </div>
        </Section>

        <MeasurementNotes
          edition={showMine ? undefined : base.edition}
          provenance={
            showMine
              ? [mineDate, mineBrowser, hardware().platform ?? "This machine", `${plural(n, "round")} per row`]
              : provenance
          }
          rawHref={showMine ? undefined : base.captures[0]?.href}
          items={notes}
          libraries={LIBRARIES}
        />

        <BuildMeasure base={base} mineRows={mineRows} runs={runs} mineRun={mineRun} />
        <ResultsTarget>{session.announcement}</ResultsTarget>
      </ReleaseBody>
    </HighlightScope>
  );
};

/** "Measure on this machine": the workload and input choices, run form, progress, outcome, exports and the run picker. */
function BuildMeasure({ base, mineRows, runs, mineRun }: { base: Setting; mineRows: readonly ResultRow[]; runs: readonly number[]; mineRun: number | undefined }) {
  const session = useBuildSession();
  const activeRun = useActiveRun();
  const simd = useSupport(simdSupported);
  const running = activeRun === "build";
  const { results, progress } = session;
  const plan = planFor(session.subjects, session.corpora);
  const samplesError = integerError(session.sampleCount, MIN_PAIRED_ROUNDS, MAX_SAMPLES);
  const otherRunning = activeRun !== null && activeRun !== "build";
  const disabledReason =
    simd === false ? (
      "This browser doesn't support WebAssembly SIMD, so it can't run the simd128 builds. The reference results above still apply."
    ) : otherRunning ? (
      <OtherRunning benchmark={activeRun} />
    ) : plan.length === 0 ? (
      "Choose at least one workload and, for the codecs, one input."
    ) : samplesError ? (
      "Fix the highlighted field to run."
    ) : undefined;
  // The latest run's own rows: a run cancelled before its first row has none.
  const lastRows = results.filter((r) => r.run === session.lastRun);
  const outcome: RunOutcome | undefined = session.error
    ? { kind: "failed", message: [session.error, recovery(session.error)].filter(Boolean).join("; ") }
    : session.cancelled
      ? { kind: "cancelled", measured: lastRows.length, total: session.planned, unit: "rows" }
      : lastRows.some((r) => !r.checksumsMatch)
        ? {
            kind: "mismatch",
            what: "A build",
            message: `The builds computed different outputs on ${listText(lastRows.filter((r) => !r.checksumsMatch).map(rowLabel))}, so those rows are not valid comparisons. They are marked in the table and left out of the figures.`,
          }
        : lastRows.length
          ? { kind: "done", measured: lastRows.length, unit: lastRows.length === 1 ? "row" : "rows" }
          : undefined;
  // Sampling time on the reference machine for this plan, from its Chrome capture.
  const estimateMs = plan.reduce((sum, step) => {
    const r = base.rows.find((x) => x.subject === step.subject && (step.subject === "alloc" || x.input.name === step.corpus));
    return r && Number.isFinite(session.sampleCount) ? sum + variantIds.length * session.sampleCount * Math.max(MIN_SAMPLE_MS, summarize(r.samples[BASELINE]).median * r.repetitions) : sum;
  }, 0);
  const estimate =
    estimateMs > 0
      ? `This choice sampled for about ${estimateMs >= 90_000 ? plural(Math.round(estimateMs / 60_000), "minute") : plural(Math.max(1, Math.round(estimateMs / 1000)), "second")} on the reference machine in ${base.engine}, plus a few seconds per row to load, calibrate and warm up.`
      : undefined;
  const PREP = 3;
  const fraction = progress ? (progress.step + (progress.prep * PREP + progress.completed) / (PREP + progress.total)) / progress.steps : 0;
  return (
    <MeasureSection
      intro={
        <>
          <p>Each row times all six builds and the A/A instance.</p>
          {estimate ? <p>{estimate}</p> : null}
        </>
      }
      configurations={
        <fieldset disabled={running} className="min-w-0">
          <legend className="sr-only">Workloads to run</legend>
          <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {subjectKeys.map((k) => (
              <li key={k}>
                <label className="flex cursor-pointer items-baseline gap-2 py-1 text-[0.9375rem] has-disabled:cursor-not-allowed">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 translate-y-[2px] accent-[var(--c-accent)]"
                    checked={session.subjects.includes(k)}
                    onChange={(e) => setSubjects(subjectKeys.filter((x) => (x === k ? e.target.checked : session.subjects.includes(x))))}
                  />
                  <span className="font-semibold text-ink">{subjects[k].label}</span>
                  <span className="text-xs whitespace-nowrap text-ink-3">{k === "alloc" ? "xml, once" : subjects[k].language}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      }
      input={
        <fieldset disabled={running} className="min-w-0">
          <legend className="sr-only">Inputs for the codec workloads</legend>
          <ul className="flex flex-wrap gap-x-6 gap-y-0.5">
            {BUILD_CORPORA.map((c) => (
              <li key={c}>
                <label className="flex cursor-pointer items-baseline gap-2 py-1 text-[0.9375rem] has-disabled:cursor-not-allowed">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 translate-y-[2px] accent-[var(--c-accent)]"
                    checked={session.corpora.includes(c)}
                    onChange={(e) => setCorpora(BUILD_CORPORA.filter((x) => (x === c ? e.target.checked : session.corpora.includes(x))))}
                  />
                  <span className="font-semibold text-ink">{c}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm text-ink-2">{plural(plan.length, "row")} to run.</p>
        </fieldset>
      }
      samples={
        <div className="flex flex-wrap items-center gap-2.5 text-sm text-ink-2">
          <NumberInput
            id="build-samples"
            aria-label="Rounds per row"
            min={MIN_PAIRED_ROUNDS}
            max={MAX_SAMPLES}
            value={session.sampleCount}
            onValueChange={setSampleCount}
            disabled={running}
            aria-invalid={samplesError ? true : undefined}
            aria-describedby={samplesError ? "build-samples-hint" : undefined}
            className={numberFieldClass}
          />
          <label htmlFor="build-samples">
            rounds per row, each timing all seven variants. A 95% CI needs at least {MIN_PAIRED_ROUNDS}; the reference used {base.edition.method.samples}.
          </label>
          {samplesError ? (
            <span id="build-samples-hint" className="basis-full text-danger">
              {samplesError}
            </span>
          ) : null}
        </div>
      }
      run={{
        label: `Run ${plural(plan.length, "row")}`,
        onRun: () => startRun(plan),
        disabled: simd !== true || otherRunning || plan.length === 0 || samplesError !== undefined,
        disabledReason,
      }}
      onCancel={running ? cancelRun : undefined}
      running={running}
      progress={
        running
          ? {
              fraction,
              label: session.cancelling ? "Cancelling" : (progress?.phase ?? "Starting"),
              detail: progress
                ? `${subjects[progress.subject].label}, row ${progress.step + 1} of ${progress.steps}${progress.prep >= 1 ? `, round ${progress.completed} of ${progress.total}` : ""}`
                : undefined,
            }
          : undefined
      }
      outcome={outcome}
      exports={mineRows.length ? <RunExport rows={mineRows} /> : <span className="text-ink-3">Export after a run: CSV, JSON, Markdown</span>}
    >
      {runs.length > 1 ? (
        <MeasureRow label="Your runs">
          <ChoiceChips
            label="Run shown as This machine, newest first"
            value={String(mineRun)}
            onChange={(v) => selectRun(Number(v))}
            options={runs.map((id) => {
              const rs = results.filter((r) => (r.run ?? 0) === id);
              return { value: String(id), label: `Run ${id}`, detail: `${plural(rs.length, "row")}, ${plural(rs[0].samples[BASELINE].length, "round")}` };
            })}
          />
        </MeasureRow>
      ) : null}
    </MeasureSection>
  );
}

/** A Table 1 header: SIMD on one line, wasm-opt on the next. */
const VariantHead = ({ v }: { v: VariantId }) => {
  if (v === AA) {
    return <>A/A</>;
  }
  const [simdOn, opt] = v.split("-");
  return (
    <span className="block whitespace-nowrap">
      {simdOn === "on" ? "simd128" : "scalar"}
      <br />
      {opt === "none" ? "no wasm-opt" : `-${opt}`}
    </span>
  );
};

/** What the wasm compiles to in V8 (see the figure's Source line). */
const MECHANISM = `;; zlib-rs compare256, wasm32 + simd128, per 16 bytes
(i8x16.eq a b)        ;; 0xff where bytes match
(i8x16.bitmask ...)   ;; one bit per byte

;; x86-64 (V8): one instruction each
pcmpeqb   xmm0, xmm1
pmovmskb  eax, xmm0

;; arm64 (V8): no single equivalent for i8x16.bitmask;
;; V8 emits a multi-instruction sequence (which one
;; depends on the CPU's features)`;

const matrixHeader = ["machine", "browser", "capture", "workload", "input", "rounds", "runs_per_sample", "shipped_median_ms", ...OTHERS.flatMap((v) => [`${v}_ratio`, `${v}_ci_lo`, `${v}_ci_hi`, `${v}_claim`]), "outputs_match"];

const matrixLine = (machine: string, browser: string, capture: number | string, r: ResultRow) => {
  const vs = againstBaseline(r);
  return [
    machine,
    browser,
    capture,
    r.subject,
    inputName(r),
    r.samples[BASELINE].length,
    r.repetitions,
    summarize(r.samples[BASELINE]).median,
    ...OTHERS.flatMap((v) => [vs[v].median, vs[v].ci?.lo, vs[v].ci?.hi, vs[v].claim]),
    r.checksumsMatch,
  ];
};

/** Table 1 for every reference capture (or this run): CSV, JSON, Markdown. */
function MatrixExport({ settings, mine }: { settings?: readonly Setting[]; mine?: readonly ResultRow[] }) {
  const lines = () =>
    mine
      ? mine.map((r) => matrixLine("this-machine", r.context?.browser ?? "unknown", "this run", r))
      : (settings ?? []).flatMap((s) => [s.rows, ...s.repeats].flatMap((rows, i) => sortRows(rows).map((r) => matrixLine(s.machine.id, s.engine, i + 1, r))));
  return (
    <ExportButtons
      baseName={mine ? `build-settings-this-machine-${fileDate(mine[0].startedAt)}` : `build-settings-reference-${settings?.[0]?.edition.id ?? ""}`}
      csv={() => toCSV(matrixHeader, lines())}
      json={() => JSON.stringify({ benchmark: "build", statistic: "median of per-round time ÷ shipped build (off-Os), order-statistic 95% CI", columns: matrixHeader, rows: lines() }, null, 2)}
      markdown={() =>
        toMarkdown(
          ["Machine", "Browser", "Capture", "Workload", "Input", "simd128 -Os ÷ shipped", "no wasm-opt ÷ shipped", "A/A"],
          lines().map((l) => [String(l[0]), String(l[1]), String(l[2]), String(l[3]), String(l[4]), ratioCell(l, "on-Os"), ratioCell(l, "off-none"), ratioCell(l, AA)]),
          [false, false, false, false, false, true, true, true],
        )
      }
    />
  );
}

const ratioCell = (line: unknown[], v: VariantId) => {
  const i = matrixHeader.indexOf(`${v}_ratio`);
  return `${(line[i] as number).toFixed(3)} (${(line[i + 1] as number | undefined)?.toFixed(3) ?? "?"}–${(line[i + 2] as number | undefined)?.toFixed(3) ?? "?"})`;
};

/** The visitor's run, every per-round sample: JSON, CSV, Markdown. */
function RunExport({ rows }: { rows: readonly ResultRow[] }) {
  return (
    <ExportButtons
      baseName={`build-settings-run-${rows[0].run ?? 0}-${fileDate(rows[0].startedAt)}`}
      json={() =>
        JSON.stringify(
          {
            benchmark: "build",
            scope: "this run",
            userAgent: navigator.userAgent,
            ...hardware(),
            build: { commit: build.commit, artifacts: build.artifacts.filter((a) => a.name.startsWith("variants/")) },
            method: { minSampleMs: MIN_SAMPLE_MS, order: "rotate", paired: true, baseline: BASELINE, aa: AA },
            rows,
            aa: rows.map((r) => ({ subject: r.subject, input: inputName(r), ...aaEffect(r) })),
          },
          null,
          2,
        )
      }
      csv={() =>
        toCSV(
          ["run", "workload", "input", "variant", "round", "ms_per_run", "runs_per_sample", "outputs_match", "browser"],
          rows.flatMap((r) => variantIds.flatMap((v) => r.samples[v].map((x, i) => [r.run ?? 0, r.subject, inputName(r), v, i + 1, x, r.repetitions, r.checksumsMatch, r.context?.browser ?? ""]))),
        )
      }
      markdown={() =>
        `${rows[0].context?.browser ?? navigator.userAgent}; ${hardware().hardwareConcurrency ?? "?"} logical cores; ${hardware().platform ?? "unknown platform"}.\n\n` +
        toMarkdown(
          ["Workload", "Input", "Shipped per run", "simd128 -Os ÷ scalar -Os", "no wasm-opt ÷ -Os", "A/A"],
          rows.map((r) => {
            const e = (id: string) => contrast(r, contrastById(id)!).effect;
            const f = (x: ReturnType<typeof e>) => `${x.median.toFixed(3)}${x.ci ? ` (${x.ci.lo.toFixed(3)}–${x.ci.hi.toFixed(3)})` : ""}`;
            return [subjects[r.subject].label, inputName(r), ms(summarize(r.samples[BASELINE]).median), f(e("simd@Os")), f(e("skip-wasm-opt@off")), f(e("aa"))];
          }),
          [false, false, true, true, true, true],
        ) +
        "\n"
      }
    />
  );
}

