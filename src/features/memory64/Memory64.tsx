import { DotRange, type DotRangeRow, Legend, ratioTick, Tip } from "@/components/charts";
import { ExportButtons } from "@/components/ExportButtons";
import { integerError, NumberInput, numberFieldClass } from "@/components/Field";
import {
  captureNote,
  Cited as CitedText,
  ChoiceChips,
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
  useSupport,
} from "@/components/release";
import { MIN_SAMPLE_MS } from "@/lib/bench";
import { build, buildSummary, hardware } from "@/lib/build";
import { fileDate, toCSV, toMarkdown } from "@/lib/export";
import { ask, cellKey, machineLabel, listText, pct, relativeSentence, relativeTo, replicatesOf } from "@/lib/findings";
import { formatDuration, formatInteger, formatMiB, plural, quantity } from "@/lib/format";
import { useActiveRun } from "@/lib/runRegistry";
import { isPairedClaim, summarize } from "@/lib/stats";
import { memorySame, runClaim, timeEffect } from "./claims";
import {
  buildSpeeds,
  effectWords,
  editionFindings,
  figureTitle,
  gatedFindings,
  memory64Questions,
  memory64Relative,
  type Memory64Cell,
} from "./findings";
import type { ResultRow } from "./harness";
import { reference } from "./reference";
import { cancelRun, markViewed, MAX_ROUNDS, MIN_ROUNDS, selectRun, setParam, setSampleCount, startRun, useMemory64Session } from "./session";
import { supportsMemory64, variants, type WorkloadParam, workloads } from "./workloads";

const WORKLOAD = "editor" as const;
/** One engine's run (today one workload each): a group of rows in Figure 1 and a row in the table. */
type Entry = { id: string; engine: string; short: string; row: ResultRow; replicates: ResultRow[] };
const TABLE_ID = "memory64-table";

/** "230–245 ms", the unit once when both ends share it. */
const msRange = (a: number, b: number) => {
  const [x, y] = [formatDuration(a), formatDuration(b)];
  return x.unit === y.unit ? `${x.value}–${quantity(y)}` : `${quantity(x)}–${quantity(y)}`;
};
const workloadText = (row: ResultRow) => `${workloads[row.workload].name}, ${formatInteger(row.params.entities)} entities`;
const memoryRatio = (row: ResultRow) => row.memoryBytes.wasm64 / row.memoryBytes.wasm32;
/** A ratio of peak memories in words: "3.8% higher", "about the same". */
const memoryWords = (row: ResultRow) => {
  const r = memoryRatio(row);
  return memorySame(row) ? "about the same" : `${pct(r - 1)} ${r > 1 ? "higher" : "lower"}`;
};
/** A generated sentence with its "(Figure n)" turned into a link to the figure (the shared `Cited`). */
const Cited = ({ text }: { text: string }) => <CitedText text={text} />;

/** Why there are no main points: claims waiting on a second capture, or none at all. */
const noPoints = (pending: number, replicated: boolean) =>
  pending === 0
    ? "Neither time nor peak memory differed beyond the threshold between wasm64 and wasm32, so there are no main points."
    : `${plural(pending, "finding")} cleared the threshold in this capture, but ${replicated ? `${pending === 1 ? "did" : "do"} not hold in the second capture` : `no second independent capture exists yet to reproduce ${pending === 1 ? "it" : "them"}`}, so the table reports ${pending === 1 ? "it" : "them"} instead.`;

/** What to try after an error, by its kind. */
const recovery = (error: string) =>
  /memory|grow|unreachable|alloc/i.test(error)
    ? "it likely ran out of Wasm memory; try fewer entities"
    : /worker|import|fetch|load|compile|instantiate/i.test(error)
      ? "a build or its worker failed to load"
      : undefined;

/**
 * The page. When the drift gate withholds every reference setting (their
 * two captures disagreed), it says so and offers no figures.
 */
export const Memory64 = () => {
  const ref = reference();
  return ref.settings.length ? <Memory64Release /> : <WithheldReference note={ref.withheldNote} edition={ref.editionId} />;
};

/**
 * Every reference setting withheld by the drift gate: no reference to
 * show, the note why, and the Measure section, so a visitor can still run
 * the comparison here. A run's verdict becomes the one main point.
 */
const WithheldReference = ({ note, edition }: { note: string; edition: string }) => {
  const session = useMemory64Session();
  const mine = session.results.find((r) => r.id === session.selected) ?? session.results[0];
  return (
    <HighlightScope>
      <ReleaseHeader measure title="wasm64 against wasm32 in WebAssembly" meta={[{ label: "Reference edition", value: edition }]} notice={note ? <ReleaseNotice>{note}</ReleaseNotice> : undefined} />
      <ReleaseBody
        sections={[
          { id: "points", title: "Main points" },
          { id: "measure", title: "Measure on this machine" },
        ]}
      >
        <Section id="points">
          <MainPoints
            tone={mine ? "mine" : "accent"}
            points={mine ? [{ id: "mine", text: `On this machine (${mine.context?.browser ?? "this browser"}): ${runClaim(mine)}` }] : []}
            empty="The reference captures for this edition disagreed with their repeats, so nothing is shown until they are recaptured. You can still measure in this browser below."
          />
        </Section>
        <Memory64Measure mine={mine} />
        <ResultsTarget>{session.announcement}</ResultsTarget>
      </ReleaseBody>
    </HighlightScope>
  );
};

const Memory64Release = () => {
  const ref = reference();
  const session = useMemory64Session();
  const { results } = session;

  // Reference settings: the reference machine, every engine measured on it side by side.
  const base = ref.settings[0];
  const shown = ref.settings.filter((s) => s.machine.id === base.machine.id);
  const current = shown[0] ?? base;
  const unmeasured = ref.unmeasured.map((b) => (b === "Safari" ? "Safari does not support memory64." : `${b} was not measured.`));

  // This machine: the selected run, newest by default. A newly finished run opens as This machine.
  const mine = results.find((r) => r.id === session.selected) ?? results[0];
  const [dataset, setDataset] = useDataset(results[0]?.id, session.viewed, markViewed);
  const showMine = dataset === "mine" && mine !== undefined;
  const tone = showMine ? "mine" : "accent";
  const machine = showMine ? THIS_MACHINE : current.machine;
  // One entry per engine (and, later, per workload): the figure and table show them together.
  const entries: Entry[] = showMine
    ? [{ id: "mine", engine: mine.context?.browser ?? "This browser", short: `${mine.context?.browser ?? "This browser"} on this machine`, row: mine, replicates: [] }]
    : shown.map((s) => ({ id: s.edition.browser.id, engine: s.engine, short: s.browser, row: s.run, replicates: s.replicates }));
  const rows = entries.map((e) => e.row);
  const cellOf = (e: Entry, row: ResultRow): Memory64Cell => ({ engine: e.short, machine, input: null, row });
  const cells = entries.map((e) => cellOf(e, e.row));
  // Replicates, index-aligned across engines: replicate i of every engine is one independent re-capture.
  // Gated setting by setting: an engine missing a repeat drops out of the time claim alone.
  const replicateCells = showMine ? undefined : replicatesOf(entries, (e) => e.replicates, (e, row) => cellOf(e, row));
  const repCount = replicateCells?.length ?? 0;
  const [time, memory] = gatedFindings(cells, replicateCells);
  const findings = [time, memory];
  // Headline claims this capture makes that a second capture hasn't reproduced: table only.
  const pending = showMine ? [] : memory64Questions.flatMap((q, i) => (findings[i].claim ? [] : (ask(q, cells).claim ?? [])));
  const valid = rows.every((r) => r.checksumsMatch);
  const n = rows[0].samples.wasm32.length;

  // This machine is compared with the reference in its own engine when that was captured, else the reference browser.
  const refFor = showMine ? (shown.find((s) => (mine.context?.browser ?? "").split(" ")[0] === s.browser) ?? current) : current;
  const comparable = showMine && mine.checksumsMatch && mine.params.entities === refFor.run.params.entities;
  const rel = comparable ? relativeTo(buildSpeeds(refFor.run), buildSpeeds(mine)) : undefined;
  const relFinding = rel ? ask(memory64Relative, rel) : undefined;
  const refName = `the ${refFor.engine} reference`;
  const confounded = showMine && (mine.context?.browser ?? "").split(" ")[0] !== refFor.browser;

  // Reference points read every engine on every machine of the edition, so a machine switch doesn't change them.
  const pointFindings = showMine ? findings : editionFindings(ref.settings.map((s) => ({ engine: s.browser, machine: s.machine, run: s.run, replicates: s.replicates })));
  const points: MainPoint[] = pointFindings.filter((f) => f.claim).map((f) => ({ id: f.claim!.key, text: <Cited text={f.claim!.text} /> }));
  if (rel) {
    points.push({ id: "relative", text: <Cited text={`${overallOnly(relativeSentence(rel, "This machine", refName))} (Figure 2).`} /> });
  }

  // The H1 names the edition's month only when it shows the edition.
  const editionMonth = showMine ? undefined : monthOf(current.edition.id);

  const sections = [
    { id: "points", title: "Main points" },
    { id: "ratio", title: "wasm64 against wasm32" },
    ...(rel ? [{ id: "compare", title: "Against the reference" }] : []),
    { id: "table", title: "Results" },
    { id: "measure", title: "Measure on this machine" },
  ];

  // A row is marked only where its finding holds: membership in the claim's reproduced cells, not "some claim exists".
  const inClaim = (f: typeof time, e: Entry) => (f.claim?.cells ?? []).some((c) => cellKey(c) === cellKey(cellOf(e, e.row)));
  // Time only: peak memory is exact, so it is labelled values under the plot, not a dot on the ratio axis.
  const figureRows: DotRangeRow[] = entries.map((entry) => {
    const e = timeEffect(entry.row);
    return {
      id: `${entry.id}:time`,
      key: entry.id,
      label: entry.engine,
      value: e.median,
      range: e.ci ? ([e.ci.lo, e.ci.hi] as const) : undefined,
      faint: [e.min, e.max] as const,
      highlight: inClaim(time, entry),
    };
  });
  const rowById = (id: string) => entries.find((e) => id.startsWith(`${e.id}:`))!.row;

  const sub = (text: React.ReactNode) => <small className="block text-xs leading-tight text-ink-3">{text}</small>;
  const timeCell = (r: ResultRow, v: (typeof variants)[number]) => {
    const st = summarize(r.samples[v]);
    return (
      <>
        {ms(st.median)}
        {sub(st.n > 1 ? `min–max ${msRange(st.min, st.max)}` : "one sample")}
      </>
    );
  };
  const columns: Column<Entry>[] = [
    {
      id: "engine",
      header: "Browser",
      render: (e) => (
        <span className="block min-w-[96px] font-semibold">{e.engine}</span>
      ),
    },
    ...variants.map((v): Column<Entry> => ({ id: v, header: `${v} time`, align: "right", render: (e) => timeCell(e.row, v) })),
    {
      id: "time",
      header: "Time ÷",
      align: "right",
      render: ({ row: r }) => {
        const e = timeEffect(r);
        return (
          <>
            <span className={r.checksumsMatch && isPairedClaim(e.claim) ? "font-semibold" : undefined}>{e.median.toFixed(3)}</span>
            {sub(e.ci ? `95% CI ${e.ci.lo.toFixed(3)}–${e.ci.hi.toFixed(3)}` : "too few rounds")}
          </>
        );
      },
    },
    {
      id: "range",
      header: "Time ÷ min–max",
      quiet: true,
      render: ({ row: r }) => {
        const e = timeEffect(r);
        return e.n > 1 ? `${e.min.toFixed(3)}–${e.max.toFixed(3)}` : "one round";
      },
    },
    {
      id: "peak",
      header: "Peak memory",
      align: "right",
      render: ({ row: r }) => (
        <>
          {formatMiB(r.memoryBytes.wasm64)}
          {sub(`wasm32 ${formatMiB(r.memoryBytes.wasm32)}`)}
        </>
      ),
    },
    { id: "memory", header: "Peak ÷", align: "right", render: ({ row: r }) => <span className={r.checksumsMatch && !memorySame(r) ? "font-semibold" : undefined}>{memoryRatio(r).toFixed(3)}</span> },
    { id: "checksum", header: "Checksum", render: ({ row: r }) => (r.checksumsMatch ? "matches" : "differs") },
  ];

  const workloadNote: NoteItem = {
    term: "Workload",
    detail: (
      <>
        A bevy_ecs editor session over nested groups, shapes and connectors: select a fifth of the document, drag it for 240 frames, then
        release, undo, redo and revert ({rows[0].frames} frames). One crate, built for wasm32 and wasm64 with the same nightly compiler and
        flags. The document is built untimed; then the two builds run in every round, alternating which goes first, so each round gives one
        wasm64 ÷ wasm32 ratio.
      </>
    ),
  };
  const checkNote: NoteItem = {
    term: "Checks",
    detail: "Every sample returns a checksum of the final document; a run counts only if both builds' checksums match.",
  };
  const memoryNote: NoteItem = {
    term: "Peak memory",
    detail:
      "Linear memory of each build after the run. It grows in 64 KiB pages and never shrinks, so it is the high-water mark, measured to the page. Differences within one page or 3% are not called.",
  };
  const notes: NoteItem[] = showMine
    ? [
        conditionsNote(mine, `${plural(n, "round")}, each sample a batch of at least ${MIN_SAMPLE_MS} ms (${plural(mine.repetitions, "session")} per batch).`),
        workloadNote,
        checkNote,
        memoryNote,
      ]
    : [
        workloadNote,
        checkNote,
        memoryNote,
        // Conditions above describe the first browser's capture; the others are listed here with their raw data.
        ...shown.slice(1).map(captureNote),
      ];

  // The header's one sentence.
  const headerText = showMine
    ? confounded
      ? `This browser differs from the reference's (${refFor.engine}), so engine and machine are confounded in any comparison with it.`
      : ""
    : [ref.withheldNote, ...unmeasured].filter(Boolean).join(" ");

  return (
    <HighlightScope>
      <ReleaseHeader
        measure
        title={<>wasm64 against wasm32 in WebAssembly{editionMonth ? <>: {editionMonth}</> : null}</>}
        meta={[
          showMine
            ? { label: "This machine", value: [hardware().platform, mine.context?.cores ? `${mine.context.cores} logical cores` : undefined].filter(Boolean).join(" · ") || "This machine" }
            : { label: "Reference machine", value: machineLabel(current.edition.machine) },
          { label: entries.length > 1 ? "Browsers" : "Browser", value: entries.map((e) => e.engine).join(" · ") },
          { label: "Workload", value: workloadText(rows[0]) },
          { label: "Samples", value: `${n} rounds per build` },
        ]}
        switches={
          mine ? <DatasetSwitch value={showMine ? "mine" : "reference"} onChange={setDataset} hasMine={mine !== undefined} /> : undefined
        }
        notice={headerText ? <ReleaseNotice>{headerText}</ReleaseNotice> : undefined}
      />
      <ReleaseBody
        sections={sections}
      >
        <Section id="points">
          <MainPoints tone={tone} points={points} empty={valid ? noPoints(pending.length, repCount > 0) : "The builds computed different answers, so this run makes no comparison."} />
          {showMine && mine.checksumsMatch && mine.params.entities !== refFor.run.params.entities ? (
            <p className="mt-4 max-w-measure text-sm text-ink-2">
              This run used {formatInteger(mine.params.entities)} entities; {refName} used {formatInteger(refFor.run.params.entities)}, so the two
              are not compared. Run with the same number of entities to see how this machine compares.
            </p>
          ) : null}
        </Section>

        <Section id="ratio">
          <Figure
            n={1}
            title={valid ? figureTitle(time, memory, cells) : "wasm64 ÷ wasm32, not compared: checksums differ"}
            subtitle={`wasm64 ÷ wasm32 time${entries.length > 1 ? " per browser" : ""}, paired by round: median, 95% CI and min–max of ${plural(n, "round")}. Peak memory is exact.`}
            legend={
              <Legend
                items={[
                  { mark: { kind: "dot", tone }, label: showMine ? "Claimed" : "Claimed in both captures" },
                  { mark: { kind: "dot", tone: "grey" }, label: "Not claimed" },
                  { mark: { kind: "whisker", tone: "grey" }, label: "95% CI" },
                  { mark: { kind: "faint" }, label: "Min–max" },
                  { mark: { kind: "band" }, label: "±3% threshold" },
                ]}
              />
            }
          >
            {valid ? (
              <DotRange
                rows={figureRows}
                tone={tone}
                tableId={TABLE_ID}
                rangeName="95% CI"
                axis={{ kind: "ratio", reference: 1, threshold: 0.03, title: "wasm64 ÷ wasm32 (log scale)", format: (v) => v.toFixed(3), tickFormat: ratioTick, ends: ["wasm64 faster", "wasm64 slower"] }}
                renderValue={(r) => <span className={r.highlight ? "font-semibold text-ink" : undefined}>{effectWords(timeEffect(rowById(r.id)))}</span>}
                renderTip={(r) => {
                  const row = rowById(r.id);
                  const e = timeEffect(row);
                  return (
                    <Tip
                      value={`${e.median.toFixed(3)} · ${effectWords(e)}`}
                      lines={[
                        `Time per session: ${ms(summarize(row.samples.wasm64).median)} against ${ms(summarize(row.samples.wasm32).median)}`,
                        e.ci ? `95% CI ${e.ci.lo.toFixed(3)}–${e.ci.hi.toFixed(3)} · ${e.n} rounds` : `${e.n} rounds: too few for a CI`,
                        `observed min–max ${e.min.toFixed(3)}–${e.max.toFixed(3)}`,
                        ...(showMine && comparable ? [`reference ${timeEffect(refFor.run).median.toFixed(3)}`] : []),
                      ]}
                    />
                  );
                }}
                describe={(r) => {
                  const row = rowById(r.id);
                  return `${r.label}: time per session, wasm64 ÷ wasm32: ${timeEffect(row).median.toFixed(3)}, ${effectWords(timeEffect(row))}.`;
                }}
                label="wasm64 against wasm32: time per session, per browser"
              />
            ) : (
              <p className="max-w-measure text-danger">The two builds computed different checksums, so they are not compared.</p>
            )}
            {valid ? <PeakMemory entries={entries} claimed={(e) => inClaim(memory, e)} /> : null}
          </Figure>
        </Section>

        {rel && relFinding ? (
          <Section id="compare">
            {confounded ? (
              <Prose>
                <p>This browser differs from the reference&apos;s ({refFor.engine}), so engine and machine are confounded in this comparison.</p>
              </Prose>
            ) : null}
            <Figure
              n={2}
              title={relFinding.title}
              subtitle={`This machine's speed ÷ ${refName}'s, per build, divided by the overall geometric mean, so 1 means it moved with the other build. Marked points moved beyond ±3%.`}
              source={`Compared with ${sourceLine(refFor.edition, "build")}`}
            >
              <DotRange
                rows={variants.map((v) => ({ id: v, key: WORKLOAD, label: v, value: rel.normalized[v], highlight: rel.moved.includes(v) }))}
                tone="mine"
                axis={{ kind: "log", title: "Relative standing (log scale)", format: (v) => `${v.toFixed(3)}×`, tickFormat: (v) => v.toFixed(2), reference: 1, ends: ["fell behind", "pulled ahead"] }}
                label="This machine against the reference, per build"
              />
            </Figure>
          </Section>
        ) : null}

        <Section id="table">
          <DataTable
            id={TABLE_ID}
            caption="Medians with min–max, paired ratios with 95% CI; bold clears the threshold."
            columns={columns}
            rows={entries}
            rowKey={(e) => e.id}
            failed={(e) => !e.row.checksumsMatch}
            tone={tone}
            footnote={
              <>
                {pending.length ? (
                  <p>
                    Not yet reproduced in a second capture, so not a main point: {pending.map((c) => c.text).join(" ")}
                  </p>
                ) : null}
                <p>{rows[0].frames} frames per session.</p>
              </>
            }
          />
        </Section>

        <MeasurementNotes
          edition={showMine ? undefined : current.edition}
          provenance={
            showMine
              ? [runDate(mine.startedAt), mine.context?.browser ?? "this browser", ...(hardware().platform ? [hardware().platform] : []), `${plural(n, "round")} per build`]
              : editionProvenance(current.edition, { browsers: listText(entries.map((e) => e.engine)), samples: `${plural(n, "round")} per build` })
          }
          per="build"
          items={notes}
          rawHref={showMine ? undefined : current.rawHref}
          libraries={["bevy_ecs"]}
        />

        <Memory64Measure refRun={refFor.run} mine={mine} onShowRun={() => setDataset("mine")} />
        <ResultsTarget>{session.announcement}</ResultsTarget>
      </ReleaseBody>
    </HighlightScope>
  );
};

/**
 * Figure 1's peak memory: exact (one value per build, to the 64 KiB
 * page), so labelled values, never a dot with an interval. Bold where
 * the memory finding holds.
 */
const PeakMemory = ({ entries, claimed }: { entries: readonly Entry[]; claimed: (e: Entry) => boolean }) => (
  <div className="mt-5 max-w-[640px] border-t border-rule pt-3 text-sm">
    <p className="font-semibold text-ink">Peak memory, wasm32 → wasm64</p>
    <dl className="mt-1.5 grid grid-cols-[minmax(0,auto)_auto_auto] justify-start gap-x-6 gap-y-1 tabular-nums">
      {entries.map((e) => (
        <div key={e.id} className="contents">
          <dt className="text-ink-2">{e.engine}</dt>
          <dd className="text-right text-ink">
            {formatMiB(e.row.memoryBytes.wasm32)} → {formatMiB(e.row.memoryBytes.wasm64)}
          </dd>
          <dd className={claimed(e) ? "font-semibold text-ink" : "text-ink-2"}>{memoryWords(e.row)}</dd>
        </div>
      ))}
    </dl>
  </div>
);

/**
 * "Measure on this machine": the run form, progress, outcome, exports and
 * the run picker. It renders whether or not a reference is shown, so a
 * visitor can still measure when the drift gate withholds every setting.
 */
const Memory64Measure = ({ refRun, mine, onShowRun }: { refRun?: ResultRow; mine?: ResultRow; onShowRun?: () => void }) => {
  const supported = useSupport(supportsMemory64);
  const session = useMemory64Session();
  const activeRun = useActiveRun();
  const { results, progress } = session;
  const running = activeRun === "memory64";
  const { params, sampleCount } = session;
  const fields = workloads[WORKLOAD].params as readonly WorkloadParam[];
  const fieldErrors = Object.fromEntries(fields.map((p) => [p.key, integerError(params[WORKLOAD][p.key], p.min, p.max)]));
  const samplesError = integerError(sampleCount, MIN_ROUNDS, MAX_ROUNDS);
  const inputsValid = !samplesError && fields.every((p) => !fieldErrors[p.key]);
  const otherRunning = activeRun !== null && activeRun !== "memory64";
  const disabledReason =
    supported === false ? (
      `This browser doesn't support memory64, so it can't run the wasm64 build. It needs Chrome 133 or later, or Firefox 134 or later.${refRun ? " The reference results above still apply." : ""}`
    ) : otherRunning ? (
      <OtherRunning benchmark={activeRun} />
    ) : !inputsValid ? (
      "Fix the highlighted fields to run."
    ) : undefined;
  const latest = results[0];
  const outcome: RunOutcome | undefined = session.error
    ? { kind: "failed", message: [session.error, recovery(session.error)].filter(Boolean).join("; ") }
    : session.cancelled
      ? {
          kind: "cancelled",
          measured: 0,
          total: 2,
          unit: "builds",
          // A run keeps only whole rounds of both builds, so a cancel discards what it measured.
          message: "Cancelled. A run is kept only when every round finishes, so any rounds measured were discarded; the results shown are unchanged.",
        }
      : latest && !latest.checksumsMatch
        ? {
            kind: "mismatch",
            what: "wasm64 and wasm32",
            message: "wasm64 and wasm32 computed different checksums, so this run is not a valid comparison. It is marked in the table and left out of the figure.",
          }
        : latest
          ? { kind: "done", measured: 2, unit: "builds", shown: refRun ? undefined : "The result is the main point above." }
          : undefined;
  const PREP = 3;
  const fraction = progress ? (progress.prep * PREP + progress.completed) / (PREP + progress.total) : 0;
  return (
    <MeasureSection
      intro={<p>Run the same session as wasm32 and wasm64.</p>}
      run={{
        label: "Run wasm32 and wasm64",
        onRun: () => startRun(WORKLOAD),
        disabled: supported !== true || otherRunning || !inputsValid,
        disabledReason,
      }}
      onCancel={running ? cancelRun : undefined}
      running={running}
      progress={
        running
          ? {
              fraction,
              label: session.cancelling ? "Cancelling" : (progress?.phase ?? "Starting the worker"),
              detail: progress && progress.prep >= 1 ? `${progress.completed} of ${progress.total} rounds` : undefined,
            }
          : undefined
      }
      outcome={outcome}
      exports={mine ? <Memory64Export row={mine} /> : <span className="text-ink-3">Export after a run: CSV, JSON, Markdown</span>}
      input={
        <div className="space-y-2">
          {fields.map((p) => (
            <div key={p.key} className="flex flex-wrap items-center gap-2.5 text-sm text-ink-2">
              <NumberInput
                id={`m64-${p.key}`}
                aria-label={p.label}
                min={p.min}
                max={p.max}
                value={params[WORKLOAD][p.key]}
                onValueChange={(v) => setParam(WORKLOAD, p.key, v)}
                disabled={running}
                aria-invalid={fieldErrors[p.key] ? true : undefined}
                aria-describedby={fieldErrors[p.key] ? `m64-${p.key}-hint` : undefined}
                className={numberFieldClass}
              />
              <label htmlFor={`m64-${p.key}`}>
                {p.label.toLowerCase()} in the editor document.
                {refRun ? ` The reference used ${formatInteger(refRun.params[p.key])}.` : ""}
              </label>
              {fieldErrors[p.key] ? (
                <span id={`m64-${p.key}-hint`} className="basis-full text-danger">
                  {fieldErrors[p.key]}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      }
      samples={
        <div className="flex flex-wrap items-center gap-2.5 text-sm text-ink-2">
          <NumberInput
            id="m64-samples"
            aria-label="Rounds"
            min={MIN_ROUNDS}
            max={MAX_ROUNDS}
            value={sampleCount}
            onValueChange={setSampleCount}
            disabled={running}
            aria-invalid={samplesError ? true : undefined}
            aria-describedby={samplesError ? "m64-samples-hint" : undefined}
            className={numberFieldClass}
          />
          <label htmlFor="m64-samples">
            rounds, each timing both builds. A 95% CI needs at least {MIN_ROUNDS}
            {refRun ? `; the reference used ${refRun.samples.wasm32.length}` : ""}.
          </label>
          {samplesError ? (
            <span id="m64-samples-hint" className="basis-full text-danger">
              {samplesError}
            </span>
          ) : null}
        </div>
      }
    >
      {results.length > 1 ? (
        <MeasureRow label="Your runs">
          <ChoiceChips
            label="Run shown as This machine, newest first"
            value={String(mine?.id)}
            onChange={(v) => {
              selectRun(Number(v));
              onShowRun?.();
            }}
            options={results.map((r) => ({ value: String(r.id), label: `Run ${r.id}`, detail: `${formatInteger(r.params.entities)} entities, ${plural(r.samples.wasm32.length, "round")}` }))}
          />
          <p className="mt-2 text-sm text-ink-2">Newest first. The one chosen is what This machine shows.</p>
        </MeasureRow>
      ) : null}
    </MeasureSection>
  );
};

const Memory64Export = ({ row }: { row: ResultRow }) => {
  const e = timeEffect(row);
  const claim = runClaim(row);
  return (
    <ExportButtons
      baseName={`memory64-run-${row.id}-${fileDate(row.startedAt)}`}
      json={() =>
        JSON.stringify(
          {
            benchmark: "memory64",
            scope: "this run",
            userAgent: navigator.userAgent,
            ...hardware(),
            build: { ...build, toolchain: buildSummary(true) },
            method: { minSampleMs: MIN_SAMPLE_MS, order: "alternate", paired: true, statistic: "median of per-round wasm64 ÷ wasm32 ratios, order-statistic 95% CI" },
            run: row,
            timeRatio: { median: e.median, ci: e.ci ? [e.ci.lo, e.ci.hi] : null, min: e.min, max: e.max, n: e.n, claim: e.claim },
            summary: claim,
          },
          null,
          2,
        )
      }
      csv={() =>
        toCSV(
          ["run", "workload", "entities", "runs_per_sample", "frames_per_session", "build", "median_ms", "min_ms", "max_ms", "samples", "peak_memory_bytes", "checksums_match", "time_ratio_median", "time_ratio_ci_lo", "time_ratio_ci_hi", "bevy_ecs_version", "toolchain"],
          variants.map((v) => {
            const st = summarize(row.samples[v]);
            return [row.id, row.workload, row.params.entities, row.repetitions, row.frames, v, st.median, st.min, st.max, st.n, row.memoryBytes[v], row.checksumsMatch, e.median, e.ci?.lo, e.ci?.hi, build.libraries.bevy_ecs, buildSummary(true)];
          }),
        )
      }
      markdown={() =>
        `${row.context?.browser ?? navigator.userAgent}; ${hardware().hardwareConcurrency ?? "?"} logical cores; ${hardware().platform ?? "unknown platform"}.\nBuild: ${buildSummary(true)}; bevy_ecs ${build.libraries.bevy_ecs}.\n\n` +
        toMarkdown(
          ["Workload", "wasm32 per session", "wasm64 per session", "wasm64 ÷ wasm32 time (95% CI)", "Peak memory", "Checksum"],
          [
            [
              workloadText(row),
              ms(summarize(row.samples.wasm32).median),
              ms(summarize(row.samples.wasm64).median),
              `${e.median.toFixed(3)} (${e.ci ? `${e.ci.lo.toFixed(3)}–${e.ci.hi.toFixed(3)}` : "too few rounds"}), ${effectWords(e)}`,
              `${formatMiB(row.memoryBytes.wasm32)} → ${formatMiB(row.memoryBytes.wasm64)}`,
              row.checksumsMatch ? "matches" : "differs",
            ],
          ],
          [false, true, true, true, true, false],
        ) +
        "\n"
      }
    />
  );
};
