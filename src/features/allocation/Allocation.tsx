import { Link } from "@tanstack/react-router";
import { DotRange, type DotRangeCell, type DotRangeFacet, type DotRangeRow, Tip } from "@/components/charts";
import { ExportButtons } from "@/components/ExportButtons";
import { integerError, NumberInput, numberFieldClass } from "@/components/Field";
import {
  Cited as CitedText,
  ChoiceChips,
  captureNote,
  type Column,
  conditionsNote,
  DataTable,
  DatasetSwitch,
  editionProvenance,
  Figure,
  HighlightScope,
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
  ReleaseBody,
  ReleaseHeader,
  ReleaseNotice,
  ResultsTarget,
  type RunOutcome,
  runDate,
  Section,
  sourceLine,
  THIS_MACHINE,
  useDataset,
} from "@/components/release";
import type { AllocationEdition } from "@/data/editions";
import { MIN_SAMPLE_MS } from "@/lib/bench";
import { build, buildSummary, hardware } from "@/lib/build";
import { isExploratory } from "@/lib/evidence";
import { fileDate, toCSV, toMarkdown } from "@/lib/export";
import { ask, askReproduced, changeShort, listText, machineLabel, nb, relativeSentence, relativeTo } from "@/lib/findings";
import { formatBytes, formatInteger, formatSig, plural } from "@/lib/format";
import { useActiveRun } from "@/lib/runRegistry";
import { isPairedClaim, median } from "@/lib/stats";
import { type Allocator, allocatorInfo, allocators, BASELINE, baselineOf, classInfo, classOf, displayOrder } from "./allocators";
import { analyse, ciText, effectText, kBText, name, pagesBytes, signedKB, type Stat, TOO_FEW } from "./claims";
import {
  allocationRelative,
  type AllocationCell,
  allocatorCalls,
  allocatorSpeeds,
  arenaCost,
  arenaTime,
  claimAllocators,
  editionDecisions,
  generalTime,
  pointQuestions,
  sameDocuments,
  timeTitle,
} from "./findings";
import { type AllocationRun, FIXED_BATCHES } from "./harness";
import { reference, type Setting } from "./reference";
import { cancelRun, markViewed, MAX_SAMPLES, MIN_SAMPLES, selectRun, setSamples, startRun, useAllocationSession } from "./session";
import { moduleSizes } from "./sizes";

/** The crates this page measures, for Measurement notes. dlmalloc ships in std. */
const LIBRARIES = ["talc", "bumpalo", "bump-scope"] as const;
/** Allocation samples are round-aligned, so this page pairs them, also in editions captured before `method.paired` was set. */
const pairedEdition = (e: AllocationEdition): AllocationEdition => ({ ...e, method: { ...e.method, paired: true } });
const TABLE_ID = "allocation-table";
const DISCUSSION = "https://github.com/bluurryy/bump-scope/discussions/108";

const pagesText = (p: number) => `${formatInteger(p)} ${p === 1 ? "page" : "pages"} (${pagesBytes(p)})`;
const groupOf = (a: Allocator) => classInfo[classOf(a)].name;
/** "Chrome" from "Chrome 156": the engine a run or capture is in. */
const engineOf = (browser: string | undefined) => (browser ?? "").split(" ")[0];

/** One facet of Figure 1 and one time column of the table: a reference browser, or this machine's run. */
type Panel = { id: string; title: string; engine: string; run: AllocationRun; replicates: readonly AllocationRun[] };

/** A paired effect against the class baseline, named: "3.7% more time than bumpalo", "about the same time as dlmalloc". */
const vsBaseline = (s: Stat) => {
  if (s.effect === null) {
    return "class baseline";
  }
  const base = name(baselineOf(s.allocator));
  return s.effect.claim === "insufficient" ? `${TOO_FEW} with ${base}` : `${effectText(s.effect)} ${isPairedClaim(s.effect.claim) ? "than" : "as"} ${base}`;
};

/** "21 documents, 5.35 MB". */
const documentsText = (run: AllocationRun) => `${formatInteger(run.documents.sizes.length)} documents, ${formatBytes(run.documents.sizes.reduce((s, x) => s + x, 0))}`;

/** A generated sentence with its "(Figure n)" or "(Figure n; table)" linked (the shared `Cited`). */
const Cited = ({ text }: { text: string }) => <CitedText text={text} tableId={TABLE_ID} />;

/** The table's heading row for a class: "Arena · compared with bumpalo". */
const classHeading = (a: Allocator) => (
  <>
    <span className="text-sm font-semibold text-ink">{groupOf(a)}</span>
    <span className="text-cap text-ink-3"> · compared with {name(baselineOf(a))}</span>
  </>
);

/** What to try after an error, by its kind. */
const recovery = (error: string) =>
  /checksum/i.test(error)
    ? "a module returned a wrong result; running again won't fix it, so please report it"
    : /memory|grow|unreachable|alloc/i.test(error)
      ? "a module likely ran out of Wasm memory"
      : /worker|import|fetch|load|compile|instantiate|corpus/i.test(error)
        ? "the documents, a module or its worker failed to load"
        : undefined;

/** Browsers in a fixed order, so facets never reorder. */
const BROWSER_ORDER = ["chrome", "firefox", "safari"];
const browserRank = (s: Setting) => {
  const i = BROWSER_ORDER.indexOf(s.edition.browser.id);
  return i < 0 ? BROWSER_ORDER.length : i;
};

/**
 * The reference settings shown: every browser on the reference machine,
 * side by side in Figure 1, and the header's page-wide caveats (not
 * measured, withheld).
 */
function settingsShown(settings: Setting[], unmeasured: string[], withheld: string) {
  const base = settings[0] as Setting | undefined;
  const missing = unmeasured.length ? `${unmeasured.join(" and ")} ${unmeasured.length === 1 ? "was" : "were"} not measured.` : "";
  const header = [missing, withheld].filter(Boolean).join(" ");
  if (!base) {
    return { shown: [] as Setting[], current: undefined, header: withheld };
  }
  const shown = settings.filter((s) => s.machine.id === base.machine.id).sort((x, y) => browserRank(x) - browserRank(y));
  return { shown, current: shown[0] ?? base, header };
}

export const Allocation = () => {
  const ref = reference();
  const session = useAllocationSession();
  const { runs } = session;
  const st = settingsShown(ref.settings, ref.unmeasured, ref.withheldNote);
  const { current } = st;

  // This machine: the selected run, newest by default.
  const mine = runs.find((r) => r.id === session.selected) ?? runs[0];
  const [dataset, setDataset] = useDataset(runs[0]?.id, session.viewed, markViewed);
  const showMine = dataset === "mine" && mine !== undefined;
  const tone = showMine ? "mine" : "accent";
  // Figure 1's facets: every browser on the reference machine side by side, or this machine alone.
  const panels: Panel[] = showMine
    ? [{ id: "mine", title: "This machine", engine: `${mine.context?.browser ?? "This browser"} on this machine`, run: mine, replicates: [] }]
    : st.shown.map((s) => ({ id: s.edition.browser.id, title: s.engine, engine: s.browser, run: s.run, replicates: s.replicates }));
  const run: AllocationRun | undefined = panels[0]?.run;
  const validPanels = panels.filter((p) => p.run.checksumsMatch);
  const valid = validPanels.length > 0;
  const machine = showMine ? THIS_MACHINE : (current?.machine ?? THIS_MACHINE);
  const cellOf = (p: Panel, r: AllocationRun): AllocationCell => ({ engine: p.engine, machine, input: null, run: r });
  // Gated setting by setting: replicate i holds every browser with an i-th repeat.
  const reps = Math.max(0, ...validPanels.map((p) => p.replicates.length));
  const figureData = { cells: validPanels.map((p) => cellOf(p, p.run)), sizes: moduleSizes };
  const figureReps = Array.from({ length: reps }, (_, i) => ({ cells: validPanels.flatMap((p) => (p.replicates[i] ? [cellOf(p, p.replicates[i])] : [])), sizes: moduleSizes }));
  const timeFinding = (q: typeof generalTime) =>
    !valid ? undefined : showMine ? ask(q, figureData) : reps ? ask(q, figureData, figureReps) : askReproduced(q, figureData, []);
  const general = timeFinding(generalTime);
  const arena = timeFinding(arenaTime);
  // What an arena costs and buys against dlmalloc alone: context after Figure 1, not a main point.
  const costText = valid
    ? arenaCost(
        validPanels.map((p) => p.run),
        showMine ? undefined : figureReps.map((d) => d.cells.map((c) => c.run)),
        moduleSizes,
      )
    : undefined;

  // This machine against the reference in its own engine when that was captured, else Chrome's.
  const refFor = showMine ? (st.shown.find((s) => s.browser === engineOf(mine.context?.browser)) ?? current) : current;
  const mineValid = showMine && mine.checksumsMatch;
  const comparable = mineValid && refFor !== undefined && !isExploratory(mine.samples) && sameDocuments(mine, refFor.run);
  const rel = comparable ? relativeTo(allocatorSpeeds(refFor.run), allocatorSpeeds(mine)) : undefined;
  const relFinding = rel ? ask(allocationRelative, rel) : undefined;
  const refName = refFor ? `the ${refFor.engine} reference` : "the reference";
  const confounded = showMine && refFor !== undefined && engineOf(mine.context?.browser) !== refFor.browser;

  // Reference points summarise every setting of the edition, so they don't depend on what is shown; this machine's summarise its run.
  const editionCells = ref.settings.filter((s) => s.run.checksumsMatch).map((s) => ({
    cell: { engine: s.browser, machine: s.machine, input: null, run: s.run },
    replicates: s.replicates.map((r) => ({ engine: s.browser, machine: s.machine, input: null, run: r })),
  }));
  const minePoints = mineValid ? pointQuestions.flatMap((q) => ask(q, figureData).claim ?? []) : [];
  const mainPoints: MainPoint[] = (showMine ? minePoints.map((c) => ({ key: c.key, text: c.text })) : editionDecisions(editionCells, moduleSizes)).map((p) => ({
    id: p.key,
    text: <Cited text={p.text} />,
  }));
  if (rel) {
    mainPoints.push({ id: "relative", text: <Cited text={`${overallOnly(relativeSentence(rel, "This machine", refName))} (Figure 2).`} /> });
  }
  const noPoints = !run
    ? "No main points until the reference is recaptured. Measure on this machine to see this workload now."
    : !valid
      ? "The modules computed different checksums, so this run makes no comparison."
      : "Nothing cleared the threshold, so there are no main points.";

  const n = run?.samples ?? 0;
  const editionMonth = current && !showMine ? monthOf(current.edition.id) : undefined;
  const platform = hardware().platform;

  const sections = [
    { id: "points", title: "Main points" },
    ...(valid ? [{ id: "time", title: "Time per document" }] : []),
    ...(rel ? [{ id: "compare", title: "Against the reference" }] : []),
    ...(run ? [{ id: "table", title: "All allocators" }] : []),
    { id: "measure", title: "Measure on this machine" },
  ];

  const statsOf = new Map(panels.map((p) => [p.id, analyse(p.run)]));
  const statOf = (p: Panel, a: Allocator) => statsOf.get(p.id)!.find((s) => s.allocator === a)!;
  const refMedian = (a: Allocator) => (refFor ? median(refFor.run.results[a].samples) : NaN);

  // A cell is marked only where its finding holds: the claim's allocators, in the claim's reproduced cells.
  const claimed = (p: Panel, a: Allocator) =>
    [general, arena].some((f) => f?.claim && claimAllocators(f).includes(a) && (f.claim.cells ?? []).some((c) => c.engine === p.engine));
  const facetOf = (p: Panel): DotRangeFacet => ({ id: p.id, title: p.title });
  const cellFor = (p: Panel, a: Allocator): DotRangeCell | undefined => {
    if (!p.run.checksumsMatch) {
      return undefined;
    }
    const s = statOf(p, a).summary;
    return { value: s.median, range: n > 1 ? ([s.min, s.max] as const) : undefined, highlight: claimed(p, a) };
  };
  const timeRows: DotRangeRow[] = displayOrder.map((a) => {
    const one = panels.length === 1 ? cellFor(panels[0], a) : undefined;
    return {
      id: a,
      group: groupOf(a),
      label: name(a),
      detail: allocatorInfo[a].short,
      value: one?.value ?? NaN,
      range: one?.range,
      highlight: one?.highlight,
      cells: panels.length > 1 ? Object.fromEntries(panels.map((p) => [p.id, cellFor(p, a)])) : undefined,
    };
  });
  const panelById = (id: string | undefined) => panels.find((p) => p.id === id) ?? panels[0];
  // One axis for every facet and class.
  const allTimes = validPanels.flatMap((p) => statsOf.get(p.id)!.flatMap((s) => [s.summary.median, ...(n > 1 ? [s.summary.min, s.summary.max] : [])]));
  const brotliOf = (a: Allocator) => (moduleSizes ? moduleSizes.modules[a].brotli - moduleSizes.modules[BASELINE].brotli : 0);

  const sub = (text: React.ReactNode) => <small className="block text-xs leading-tight text-ink-3">{text}</small>;
  // Per browser: the median, then the paired effect against the class baseline with its CI.
  const timeColumn = (p: Panel): Column<Allocator> => ({
    id: `time-${p.id}`,
    header: panels.length > 1 ? p.title : "Per document",
    align: "right",
    render: (a) => {
      if (!p.run.checksumsMatch) {
        return <span className="text-danger">checksums differed</span>;
      }
      const s = statOf(p, a);
      const e = s.effect;
      return (
        <>
          <span className={claimed(p, a) ? "font-semibold" : undefined}>{ms(s.summary.median)}</span>
          {e === null
            ? sub("baseline")
            : e.claim === "insufficient"
              ? sub(TOO_FEW)
              : sub(
                  <>
                    {isPairedClaim(e.claim) ? effectText(e, true) : `about the same (${changeShort(e.median, true)})`}
                    <br />
                    95% CI {ciText(e)}
                  </>,
                )}
        </>
      );
    },
  });
  // Heap growth is deterministic per module: one value, or each browser's where they differ.
  const pagesIn = (a: Allocator) => [...new Set(validPanels.map((p) => statOf(p, a).pages))];
  const columns: Column<Allocator>[] = [
    {
      id: "allocator",
      header: "Allocator",
      render: (a) => (
        <span className="block min-w-[112px]">
          <span className="font-semibold">{name(a)}</span>
          {sub(allocatorInfo[a].short)}
        </span>
      ),
    },
    ...panels.map(timeColumn),
    {
      id: "pages",
      header: "Heap growth",
      align: "right",
      render: (a) => {
        const ps = pagesIn(a);
        return ps.length === 1 ? (
          <>
            {formatInteger(ps[0])} {ps[0] === 1 ? "page" : "pages"}
            {sub(pagesBytes(ps[0], true))}
          </>
        ) : (
          validPanels.map((p) => `${p.title}: ${formatInteger(statOf(p, a).pages)}`).join("; ")
        );
      },
    },
    {
      id: "brotli",
      header: "Download (brotli)",
      align: "right",
      render: (a) =>
        moduleSizes ? (
          <>
            {kBText(moduleSizes.modules[a].brotli)}
            {sub(a === BASELINE ? "baseline" : `${signedKB(brotliOf(a))} vs dlmalloc`)}
          </>
        ) : (
          "—"
        ),
    },
  ];

  // Notes that hold for every run of this workload.
  const classNote: NoteItem = {
    term: "Classes",
    detail:
      "dlmalloc and talc are general-purpose: they free each allocation on its own, so freed memory is reused while the program runs. bumpalo and bump-scope are arenas: they free everything at once when reset and can't free single allocations, so memory only grows until then. The two classes do different jobs, so allocators are compared only within a class.",
  };
  const workloadNote: NoteItem = {
    term: "Workload",
    detail: (
      <>
        Each document is parsed into an owned tree, walked with short-lived temporaries and dropped, while a small survivor set stays in the
        global allocator; the arena builds reset their arena after every document. All four builds run the same code on allocator-api2&apos;s
        collections (<a href={DISCUSSION}>why</a>).{" "}
        <Link to="/method" hash="allocation-workload" className="link">
          The workload in full
        </Link>
        .
      </>
    ),
  };
  const timingNote: NoteItem = {
    term: "Timing",
    detail: `Single-threaded. A sample times whole batches of every document, cleanup included (dropping each tree and, for arenas, the reset), divided by the number of documents. All four allocators run in every round, in an order rotated each round, so within a class each round gives one time ratio: its median and 95% CI decide a claim (beyond 3%, with a CI excluding 1). The first batch on a fresh instance is reported apart as First batch: it runs cold code and pays for memory.grow.`,
  };
  const heapNote: NoteItem = {
    term: "Heap growth",
    detail: `Linear memory after a fixed sequence of ${FIXED_BATCHES} batches on a fresh instance, minus its size once the documents are loaded, in 64 KiB pages; measured before any timing. Linear memory never shrinks, so these pages are kept for the module instance's lifetime. Differences within one page or 3% are not called.`,
  };
  const sizes = moduleSizes;
  const sizeNote: NoteItem = {
    term: "Download size",
    detail: sizes
      ? `Brotli (quality ${sizes.brotliQuality}) bytes of each module as shipped, after wasm-opt -Os, computed at build time; raw: ${displayOrder.map((a) => `${name(a)} ${kBText(sizes.modules[a].raw)}`).join(", ")}. Each module is the whole application, and the arena builds also link dlmalloc for their chunks and the survivor set, so the differences are between whole builds. Sizes are exact, so they need no second capture.`
      : "Module sizes are computed by `mise run build:wasm`; this build has none.",
  };
  const runNotes = (r: AllocationRun): NoteItem[] => {
    const docSizes = r.documents.sizes;
    const sorted = [...docSizes].sort((a, b) => a - b);
    return [
      {
        term: "Documents",
        detail: `${formatInteger(docSizes.length)} XML documents from the Silesia corpus's xml file (a tar), ${formatBytes(docSizes.reduce((s, x) => s + x, 0))} in all, ${formatBytes(sorted[0])} to ${formatBytes(sorted[sorted.length - 1])} (median ${formatBytes(median(docSizes))}), processed largest first so memory kept from a large document shows when smaller ones follow.${r.documents.rejected ? ` ${plural(r.documents.rejected, "tar entry")} that weren't well-formed XML were left out.` : ""}`,
      },
      { term: "Allocator calls", detail: allocatorCalls(r) },
    ];
  };
  const contextNote = (r: AllocationRun) => conditionsNote(r, `${plural(r.samples, "sample")} per allocator, each at least ${MIN_SAMPLE_MS} ms of whole batches.`);
  // Conditions describe the first browser's capture; the others are listed with their raw data.
  const captureNotes: NoteItem[] = showMine ? [] : st.shown.slice(1).map(captureNote);
  const notes: NoteItem[] = showMine
    ? [contextNote(mine), ...runNotes(mine), classNote, workloadNote, timingNote, heapNote, sizeNote]
    : run
      ? [...runNotes(run), classNote, workloadNote, timingNote, heapNote, sizeNote, ...captureNotes]
      : [classNote, workloadNote, timingNote, heapNote, sizeNote];

  return (
    <HighlightScope>
      <ReleaseHeader
        measure
        title={<>Rust allocators in WebAssembly{editionMonth ? <>: {nb(editionMonth)}</> : null}</>}
        meta={[
          showMine
            ? { label: "This machine", value: [platform, mine.context?.cores ? `${mine.context.cores} logical cores` : undefined].filter(Boolean).join(" · ") || "This machine" }
            : current
              ? { label: "Reference machine", value: machineLabel(current.edition.machine) }
              : { label: "Reference", value: "withheld; recapture pending" },
          ...(showMine ? [{ label: "Browser", value: mine.context?.browser ?? "This browser" }] : panels.length ? [{ label: panels.length > 1 ? "Browsers" : "Browser", value: panels.map((p) => p.title).join(" · ") }] : []),
          ...(run ? [{ label: "Input", value: `Silesia xml: ${documentsText(run)}` }] : []),
          ...(run ? [{ label: "Samples", value: `${n} per allocator` }] : []),
        ]}
        switches={
          mine ? <DatasetSwitch value={showMine ? "mine" : "reference"} onChange={setDataset} hasMine={mine !== undefined} /> : undefined
        }
        notice={
          showMine ? (
            confounded && refFor ? (
              <ReleaseNotice>This browser differs from the reference&apos;s ({refFor.engine}), so engine and machine are confounded in any comparison with it.</ReleaseNotice>
            ) : undefined
          ) : st.header ? (
            <ReleaseNotice>{st.header}</ReleaseNotice>
          ) : undefined
        }
      />
      <ReleaseBody sections={sections}>
        <Section id="points">
          <MainPoints tone={tone} points={mainPoints} empty={noPoints} />
          {showMine && refFor && mineValid && !comparable ? (
            <p className="mt-4 max-w-measure text-sm text-ink-2">
              {isExploratory(mine.samples)
                ? "This run has too few samples to compare with the reference."
                : "This run processed a different document set from the reference, so the two are not compared."}
            </p>
          ) : null}
        </Section>

        {valid ? (
          <Section id="time">
            <Figure
              n={1}
              title={nb(general && arena ? timeTitle(general, arena) : "Time per document")}
              subtitle={`Median time per document and observed min–max of ${plural(n, "sample")}; compare within each class.`}
            >
              <DotRange
                rows={timeRows}
                facets={panels.length > 1 ? panels.map(facetOf) : undefined}
                tone={tone}
                tableId={TABLE_ID}
                labelWidth={140}
                axis={{ kind: "log", title: "Time per document, ms (log scale)", format: (v) => formatSig(v), tickFormat: (v) => `${+v.toPrecision(3)}`, include: allTimes }}
                renderTip={(r, c, f) => {
                  const p = panelById(f?.id);
                  const a = r.id as Allocator;
                  return (
                    <Tip
                      value={ms(c.value)}
                      lines={[
                        `${r.label}${panels.length > 1 ? ` · ${p.title}` : ""} · ${vsBaseline(statOf(p, a))}`,
                        ...(c.range ? [`observed min–max ${ms(c.range[0])}–${ms(c.range[1])}`] : []),
                        `first batch ${ms(statOf(p, a).coldMs)} per document`,
                        ...(comparable ? [`${refName} ${ms(refMedian(a))}`] : []),
                      ]}
                    />
                  );
                }}
                label="Time per document per allocator, grouped by class"
              />
            </Figure>
            {costText ? (
              <Prose className="mt-6">
                <p>
                  <Cited text={costText} /> The classes do different jobs.
                </p>
              </Prose>
            ) : null}
          </Section>
        ) : null}

        {rel && relFinding && refFor ? (
          <Section id="compare">
            <Figure
              n={2}
              title={relFinding.title}
              subtitle={`This machine's speed ÷ ${refName}'s, per allocator, divided by the overall geometric mean, so 1 means it moved with the rest. Marked points moved beyond ±3%.`}
              source={`Compared with ${sourceLine(refFor.edition, "allocator")}`}
            >
              <DotRange
                rows={displayOrder.map((a) => ({ id: a, group: groupOf(a), label: name(a), value: rel.normalized[a], highlight: rel.moved.includes(a) }))}
                tone="mine"
                axis={{ kind: "log", title: "Relative standing (log scale)", format: (v) => `${v.toFixed(3)}×`, tickFormat: (v) => v.toFixed(2), reference: 1, ends: ["fell behind", "pulled ahead"] }}
                label="This machine against the reference, per allocator"
              />
            </Figure>
          </Section>
        ) : null}

        {run ? (
          <Section id="table">
            <DataTable
              id={TABLE_ID}
              caption={`Median time per document; under it, time against the class baseline, paired by round (95% CI). Heap growth over ${FIXED_BATCHES} batches; the module's brotli download.`}
              columns={columns}
              rows={[...displayOrder]}
              rowKey={(a) => a}
              group={classOf}
              groupHeading={classHeading}
              failed={() => !valid}
              tone={tone}
              footnote={valid ? undefined : <p>The modules computed different checksums: not a valid comparison.</p>}
            />
          </Section>
        ) : null}

        <MeasurementNotes
          edition={!showMine && current ? pairedEdition(current.edition) : undefined}
          provenance={
            showMine
              ? [runDate(mine.startedAt), mine.context?.browser ?? "this browser", ...(platform ? [platform] : []), `${plural(mine.samples, "sample")} per allocator`]
              : current
                ? editionProvenance(current.edition, { browsers: listText(panels.map((p) => p.title)), samples: `${plural(current.run.samples, "sample")} per allocator` })
                : [`Reference ${ref.editionId} withheld`]
          }
          per="allocator"
          items={notes}
          rawHref={!showMine && current ? current.rawHref : undefined}
          libraries={LIBRARIES}
        />

        <AllocationMeasure mine={mine} refSamples={current?.run.samples} onShowRun={() => setDataset("mine")} />
        <ResultsTarget>{session.announcement}</ResultsTarget>
      </ReleaseBody>
    </HighlightScope>
  );
};

/** "Measure on this machine": the run form, progress, outcome, exports and the run picker. */
const AllocationMeasure = ({ mine, refSamples, onShowRun }: { mine?: AllocationRun; refSamples?: number; onShowRun: () => void }) => {
  const session = useAllocationSession();
  const activeRun = useActiveRun();
  const { runs, running } = session;
  const samplesError = integerError(session.samples, MIN_SAMPLES, MAX_SAMPLES);
  const otherRunning = activeRun !== null && activeRun !== "allocation";
  const disabledReason = otherRunning ? (
    <OtherRunning benchmark={activeRun} />
  ) : samplesError ? (
    "Fix the highlighted field to run."
  ) : undefined;
  const latest = runs[0];
  const outcome: RunOutcome | undefined = session.error
    ? { kind: "failed", message: [session.error, recovery(session.error)].filter(Boolean).join("; ") }
    : session.cancelled
      ? {
          kind: "cancelled",
          measured: 0,
          total: allocators.length,
          unit: "allocators",
          // A run keeps only whole rounds of all four allocators, so a cancel discards what it measured.
          message: "Cancelled. A run is kept only when every round finishes, so any rounds measured were discarded; the results shown are unchanged.",
        }
      : latest && !latest.checksumsMatch
        ? { kind: "mismatch", what: "The modules", message: "The four modules computed different checksums, so this run is not a valid comparison. It is left out of the figures." }
        : latest
          ? { kind: "done", measured: allocators.length, unit: "allocators" }
          : undefined;
  const progress = session.progress;
  return (
    <MeasureSection
      intro={<p>Run all four allocators on the same documents.</p>}
      run={{ label: `Run ${allocators.length} allocators`, onRun: () => startRun(), disabled: !!samplesError || otherRunning, disabledReason }}
      onCancel={running ? cancelRun : undefined}
      running={running}
      progress={
        progress
          ? { fraction: progress.total ? progress.done / progress.total : 0, label: session.cancelling ? "Cancelling" : progress.phase, detail: progress.detail || undefined }
          : running
            ? { fraction: 0, label: "Starting" }
            : undefined
      }
      outcome={outcome}
      exports={mine ? <AllocationExport run={mine} /> : <span className="text-ink-3">Export after a run: CSV, JSON, Markdown</span>}
      input={
        <p className="text-sm text-ink-2">Silesia xml: 21 XML documents, 5.3 MB.</p>
      }
      samples={
        <div className="flex flex-wrap items-center gap-2.5 text-sm text-ink-2">
          <NumberInput
            id="alloc-samples"
            aria-label="Rounds"
            min={MIN_SAMPLES}
            max={MAX_SAMPLES}
            value={session.samples}
            onValueChange={setSamples}
            disabled={running}
            aria-invalid={samplesError ? true : undefined}
            aria-describedby={samplesError ? "alloc-samples-hint" : undefined}
            className={numberFieldClass}
          />
          <label htmlFor="alloc-samples">
            rounds, each timing all four allocators. A 95% CI needs at least {MIN_SAMPLES}
            {refSamples !== undefined ? `; the reference used ${refSamples}` : ""}.
          </label>
          {samplesError ? (
            <span id="alloc-samples-hint" className="basis-full text-danger">
              {samplesError}
            </span>
          ) : null}
        </div>
      }
    >
      {runs.length > 1 ? (
        <MeasureRow label="Your runs">
          <ChoiceChips
            label="Run shown as This machine, newest first"
            value={String(mine?.id)}
            onChange={(v) => {
              selectRun(Number(v));
              onShowRun();
            }}
            options={runs.map((r) => ({ value: String(r.id), label: `Run ${r.id}`, detail: `${plural(r.samples, "sample")}, ${new Date(r.startedAt).toLocaleTimeString()}` }))}
          />
          <p className="mt-2 text-sm text-ink-2">Newest first. The one chosen is what This machine shows.</p>
        </MeasureRow>
      ) : null}
    </MeasureSection>
  );
};

/** The resolved crate version behind each allocator; dlmalloc ships in std. */
const versionOf = (a: Allocator) => (a === BASELINE ? `std (${build.rustc.replace(/ \(.*\)$/, "")})` : build.libraries[a]);

const AllocationExport = ({ run }: { run: AllocationRun }) => {
  const stats = analyse(run);
  return (
    <ExportButtons
      baseName={`allocation-run-${run.id}-${fileDate(run.startedAt)}`}
      json={() =>
        JSON.stringify(
          {
            benchmark: "allocation",
            userAgent: navigator.userAgent,
            ...hardware(),
            build,
            method: {
              minSampleMs: MIN_SAMPLE_MS,
              order: "rotate",
              paired: true,
              statistic: "median ms per document; within a class, median of per-round time ratios with an order-statistic 95% CI",
              range: "observed min–max",
              fixedBatches: run.fixedBatches,
            },
            moduleSizes,
            scope: "this run",
            run: { ...run, startedAt: new Date(run.startedAt).toISOString(), endedAt: new Date(run.endedAt).toISOString() },
          },
          null,
          2,
        )
      }
      csv={() =>
        toCSV(
          ["run", "documents", "allocator", "class", "median_ms_per_document", "min_ms", "max_ms", "samples", "batches_per_sample", "first_batch_ms_per_document", "heap_growth_pages", "vs_class_baseline", "brotli_bytes", "raw_bytes", "checksums_match", "library_version"],
          stats.map((s) => {
            const a = s.allocator;
            return [run.id, run.documents.sizes.length, a, classOf(a), s.summary.median, s.summary.min, s.summary.max, s.summary.n, run.results[a].repetitions, s.coldMs, s.pages, vsBaseline(s), moduleSizes?.modules[a].brotli, moduleSizes?.modules[a].raw, run.checksumsMatch, versionOf(a)];
          }),
        )
      }
      markdown={() =>
        `**Run ${run.id}**, ${run.context?.browser ?? navigator.userAgent}, ${hardware().hardwareConcurrency ?? "?"} logical cores, ${hardware().platform ?? "unknown platform"}. Build: ${buildSummary()}; bumpalo ${build.libraries.bumpalo}, bump-scope ${build.libraries["bump-scope"]}, talc ${build.libraries.talc}.\n\nSilesia xml, ${documentsText(run)}; median of ${plural(run.samples, "sample")} with the observed min–max.\n\n` +
        toMarkdown(
          ["Allocator", "Class", "Per document", "min–max", "vs class baseline", "First batch", "Heap growth", "Brotli"],
          stats.map((s) => [
            name(s.allocator),
            groupOf(s.allocator),
            ms(s.summary.median),
            `${ms(s.summary.min)}–${ms(s.summary.max)}`,
            vsBaseline(s),
            ms(s.coldMs),
            pagesText(s.pages),
            moduleSizes ? formatBytes(moduleSizes.modules[s.allocator].brotli) : "—",
          ]),
          [false, false, true, true, false, true, true, true],
        ) +
        "\n"
      }
    />
  );
};
