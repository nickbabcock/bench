import { useState } from "react";
import { DotRange, type DotRangeCell, type DotRangeRow, Legend, ratioTick, Tip } from "@/components/charts";
import { ExportButtons } from "@/components/ExportButtons";
import { integerError, NumberInput, numberFieldClass } from "@/components/Field";
import {
  BrowserSwitch,
  captureNote,
  ChoiceChips,
  Cited,
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
  type NoteItem,
  OtherRunning,
  Prose,
  ReleaseBody,
  ReleaseHeader,
  ReleaseNotice,
  ResultsTarget,
  type RunOutcome,
  runDate,
  Section,
  THIS_MACHINE,
  useDataset,
} from "@/components/release";
import { MIN_SAMPLE_MS } from "@/lib/bench";
import { build, buildSummary, hardware } from "@/lib/build";
import { fileDate, toCSV, toMarkdown } from "@/lib/export";
import { listText, machineLabel, type MachineRef } from "@/lib/findings";
import { plural } from "@/lib/format";
import { useActiveRun } from "@/lib/runRegistry";
import { isPairedClaim, type PairedEffect, summarize } from "@/lib/stats";
import { baselineEffect, comparisonEffect, effectWords, runClaim, samplesOf } from "./claims";
import { editionFindings, figureTitle, gatedFindings, type LocksCell } from "./findings";
import type { ResultRow } from "./harness";
import { reference } from "./reference";
import { cancelRun, markViewed, MAX_ROUNDS, MIN_ROUNDS, selectRun, setSampleCount, startRun, useLocksSession } from "./session";
import { buildComparisons, type Comparison, groupInfo, lockComparisons, type Variant, variantInfo, variants, type Workload, workloads } from "./workloads";

const TABLE_ID = "locks-table";
const TITLE = "RefCell against Mutex in WebAssembly";

/** One engine's run: one browser in the switch, and a cell for the findings. */
type Entry = { id: string; engine: string; short: string; machine: MachineRef; row: ResultRow; replicates: readonly ResultRow[] };

/** "0.734 ns". */
const ns = (v: number) => (Number.isFinite(v) ? `${v < 10 ? v.toFixed(3) : v.toFixed(1)} ns` : "—");
const sub = (text: React.ReactNode) => <small className="block text-xs leading-tight text-ink-3">{text}</small>;

/** A paired effect as a figure cell: median, 95% CI, min–max; marked when it clears the claim rule. */
const effectCell = (e: PairedEffect | undefined): DotRangeCell | undefined =>
  e && Number.isFinite(e.median) ? { value: e.median, range: e.ci ? [e.ci.lo, e.ci.hi] : undefined, faint: [e.min, e.max], highlight: isPairedClaim(e.claim) } : undefined;

/** How the lock modules are built: the nightly, std from source, their own target features and no wasm-opt. */
const locksBuild = () => buildSummary(true, true);

/** The workloads a run measured in every build: a capture from an older page can lack a newer workload. */
const measuredWorkloads = (row: ResultRow) => workloads.filter((w) => row.variants.every((v) => samplesOf(row, v, w.id)?.length));

/** Why there are no main points: nothing cleared the threshold, or claims wait on a second capture. */
const noPoints = (mine: boolean, pending: number, replicated: boolean) =>
  mine
    ? "No comparison cleared the threshold in this run, so there are no main points."
    : pending === 0
      ? "No comparison cleared the threshold, so there are no main points."
      : `${plural(pending, "finding")} cleared the threshold in this capture, but ${replicated ? `${pending === 1 ? "did" : "do"} not hold in the second capture` : `no second independent capture exists yet to reproduce ${pending === 1 ? "it" : "them"}`}, so the table reports ${pending === 1 ? "it" : "them"} instead.`;

/** What to try after an error, by its kind. */
const recovery = (error: string) => (/worker|import|fetch|load|compile|instantiate/i.test(error) ? "a build or its worker failed to load" : undefined);

export const Locks = () => {
  const ref = reference();
  const session = useLocksSession();
  const { results } = session;
  const settings = ref?.settings ?? [];
  const base = settings[0];
  const shown = base ? settings.filter((s) => s.machine.id === base.machine.id) : [];

  const mine = results.find((r) => r.id === session.selected) ?? results[0];
  const [dataset, setDataset] = useDataset(results[0]?.id, session.viewed, markViewed);
  const showMine = mine !== undefined && (dataset === "mine" || shown.length === 0);
  const tone = showMine ? "mine" : "accent";
  const entries: Entry[] = showMine
    ? [{ id: "mine", engine: mine.context?.browser ?? "This browser", short: mine.context?.browser ?? "This browser", machine: THIS_MACHINE, row: mine, replicates: [] }]
    : shown.map((s) => ({ id: s.edition.browser.id, engine: s.engine, short: s.browser, machine: s.machine, row: s.run, replicates: s.replicates }));

  const [engineId, setEngineId] = useState<string>();
  const entry = entries.find((e) => e.id === engineId) ?? entries[0];

  if (!entry) {
    return <Empty note={ref?.withheldNote ?? ""} edition={ref?.editionId} />;
  }

  const cellOf = (e: Entry, row: ResultRow): LocksCell => ({ engine: e.short, machine: e.machine, input: null, row });
  const findings = showMine
    ? gatedFindings(
        entries.map((e) => cellOf(e, e.row)),
        undefined,
      )
    : editionFindings(settings.map((s) => ({ engine: s.browser, machine: s.machine, run: s.run, replicates: s.replicates })));
  const points: MainPoint[] = findings.filter((f) => f.claim).map((f) => ({ id: f.claim!.key, text: <Cited text={f.claim!.text} /> }));
  // Claims this capture makes that a second capture has not reproduced: table only.
  const pending = showMine ? [] : findings.flatMap((f) => f.tableOnly);
  const row = entry.row;
  const valid = entries.every((e) => e.row.checksumsMatch);
  const n = samplesOf(row, "abort", "op/plain")?.length ?? 0;
  const measured = variants.filter((v) => row.variants.includes(v));
  const facets = measured.map((v) => ({ id: v, title: variantInfo[v].label }));
  const current = shown.find((s) => s.edition.browser.id === entry.id);

  const sections = [
    { id: "points", title: "Main points" },
    { id: "cost", title: "Time per operation" },
    { id: "locks", title: "Mutex against RefCell" },
    { id: "builds", title: "What each build costs" },
    { id: "table", title: "Results" },
    { id: "measure", title: "Measure on this machine" },
  ];

  // Figure 1: ns per operation, every workload in every build.
  const shownWorkloads = measuredWorkloads(row);
  const costRows: DotRangeRow[] = shownWorkloads.map((w) => ({
    id: w.id,
    label: w.id,
    detail: w.code,
    group: groupInfo[w.group].title,
    value: NaN,
    cells: Object.fromEntries(
      measured.map((v) => {
        const st = summarize(samplesOf(row, v, w.id)!);
        return [v, { value: st.median, range: [st.min, st.max] as const }];
      }),
    ),
  }));

  // Figure 2 and 3: paired ratios, one row per comparison, one facet per build.
  const ratioRows = (template: Comparison[], of: (v: Variant) => Comparison[], vs: readonly Variant[]): DotRangeRow[] =>
    template.map((c, i) => ({
      id: c.id.replace(/:.*$/, ""),
      label: c.label,
      value: NaN,
      cells: Object.fromEntries(vs.map((v) => [v, effectCell(comparisonEffect(row, of(v)[i]))])),
    }));
  const lockRows = ratioRows(lockComparisons("abort"), lockComparisons, measured);
  const others = (["unwind", "atomics"] as const).filter((v) => measured.includes(v));
  const buildRows = ratioRows(buildComparisons("unwind"), (v) => buildComparisons(v as "unwind" | "atomics"), others);
  const ratioAxis = (title: string) => ({
    kind: "ratio" as const,
    reference: 1,
    threshold: 0.03,
    title,
    format: (v: number) => v.toFixed(3),
    tickFormat: ratioTick,
    ends: ["less time", "more time"] as [string, string],
  });
  const ratioTip = (r: DotRangeRow, c: DotRangeCell, f?: { id: string; title: React.ReactNode }) => (
    <Tip
      value={`${c.value.toFixed(3)}`}
      lines={[`${r.label}${f ? ` · ${variantInfo[f.id as Variant].label}` : ""}`, ...(c.range ? [`95% CI ${c.range[0].toFixed(3)}–${c.range[1].toFixed(3)}`] : ["too few rounds for a CI"]), ...(c.faint ? [`observed min–max ${c.faint[0].toFixed(3)}–${c.faint[1].toFixed(3)}`] : [])]}
    />
  );
  const ratioLegend = (
    <Legend
      items={[
        { mark: { kind: "dot", tone }, label: "Clears the threshold" },
        { mark: { kind: "dot", tone: "grey" }, label: "Not claimed" },
        { mark: { kind: "whisker", tone: "grey" }, label: "95% CI" },
        { mark: { kind: "faint" }, label: "Min–max" },
        { mark: { kind: "band" }, label: "±3% threshold" },
      ]}
    />
  );

  const columns: Column<Workload>[] = [
    {
      id: "workload",
      header: "Workload",
      render: (w) => (
        <>
          <span className="block font-semibold">{w.id}</span>
          {sub(<code>{w.code}</code>)}
        </>
      ),
    },
    ...measured.map(
      (v): Column<Workload> => ({
        id: v,
        header: variantInfo[v].label,
        align: "right",
        render: (w) => {
          const st = summarize(samplesOf(row, v, w.id)!);
          const e = baselineEffect(row, v, w.id);
          return (
            <>
              <span className={e && isPairedClaim(e.claim) ? "font-semibold" : undefined}>{ns(st.median)}</span>
              {sub(e ? `${e.median.toFixed(2)}× ${w.baseline}` : "baseline")}
            </>
          );
        },
      }),
    ),
  ];

  const builds = measured.map((v) => `${variantInfo[v].label}: ${variantInfo[v].detail}${row.flags[v] ? ` The module reports ${row.flags[v]}.` : ""}`);
  const skipped = variants.filter((v) => row.skipped[v]).map((v) => `${variantInfo[v].label} was not measured: ${row.skipped[v]}.`);
  const notes: NoteItem[] = [
    ...(showMine ? [conditionsNote(mine, `${plural(n, "round")}, each sample a batch of at least ${MIN_SAMPLE_MS} ms of ${row.iterations} iterations per call.`)] : []),
    {
      term: "Workloads",
      detail: (
        <ul className="list-disc space-y-1 pl-5">
          {(Object.keys(groupInfo) as (keyof typeof groupInfo)[]).map((g) => (
            <li key={g}>
              <b className="font-semibold">{g}</b>: {groupInfo[g].detail}
            </li>
          ))}
        </ul>
      ),
    },
    {
      term: "Builds",
      detail: (
        <ul className="list-disc space-y-1 pl-5">
          {[...builds, ...skipped].map((b) => (
            <li key={b}>{b}</li>
          ))}
          <li>All three use {locksBuild()}. Binaryen inlines and folds by itself, so wasm-opt would hide what LLVM emitted for each lock.</li>
        </ul>
      ),
    },
    {
      term: "Design",
      detail:
        "The containers live on the heap for the whole run, so the optimizer can not delete a lock because only the timed function sees it. Reads compare with a plain read, not with a read-modify-write. There is no sequentially consistent atomic row, because no build here lowers it differently from the relaxed one.",
    },
    {
      term: "Checks",
      detail: "Before timing, each workload runs once on fresh containers in every build. If any build returns a different digest, the run stops before it times anything.",
    },
    {
      term: "Engines inline",
      detail:
        "#[inline(never)] binds LLVM only. An engine can inline a kernel into its loop (V8 does), so an op row is the cost of the operation as the engine runs it, not of a call.",
    },
    ...(showMine ? [] : shown.filter((s) => s !== current).map(captureNote)),
  ];

  const editionMonth = showMine || !current ? undefined : monthOf(current.edition.id);
  const notice = [ref?.withheldNote, ...(ref?.unmeasured ?? []).map((b) => `${b} was not measured.`)].filter(Boolean).join(" ");

  return (
    <HighlightScope>
      <ReleaseHeader
        measure
        title={
          <>
            {TITLE}
            {editionMonth ? <>: {editionMonth}</> : null}
          </>
        }
        meta={[
          showMine
            ? { label: "This machine", value: [hardware().platform, mine.context?.cores ? `${mine.context.cores} logical cores` : undefined].filter(Boolean).join(" · ") || "This machine" }
            : { label: "Reference machine", value: machineLabel(current!.edition.machine) },
          { label: entries.length > 1 ? "Browsers" : "Browser", value: entries.map((e) => e.engine).join(" · ") },
          { label: "Builds", value: measured.map((v) => variantInfo[v].label).join(" · ") },
          { label: "Samples", value: `${n} rounds per cell` },
        ]}
        switches={
          <>
            {mine && shown.length ? <DatasetSwitch value={showMine ? "mine" : "reference"} onChange={setDataset} hasMine /> : null}
            {entries.length > 1 ? <BrowserSwitch value={entry.id} options={entries.map((e) => ({ value: e.id, label: e.short }))} onChange={setEngineId} /> : null}
          </>
        }
        notice={notice && !showMine ? <ReleaseNotice>{notice}</ReleaseNotice> : undefined}
      />
      <ReleaseBody sections={sections}>
        <Section id="points">
          <MainPoints
            tone={tone}
            points={points}
            empty={valid ? noPoints(showMine, pending.length, entries.some((e) => e.replicates.length > 0)) : "The builds computed different answers, so this run makes no comparison."}
          />
        </Section>

        <Section id="cost">
          <Figure
            n={1}
            title={`Time per operation, ${entry.engine}`}
            subtitle={`ns per operation: median and min–max of ${plural(n, "round")}, each a batch of ${row.iterations}-iteration calls. Lower is better.`}
            legend={
              <Legend
                items={[
                  { mark: { kind: "dot", tone: "grey" }, label: "Median" },
                  { mark: { kind: "whisker", tone: "grey" }, label: "Min–max" },
                ]}
              />
            }
          >
            <DotRange
              rows={costRows}
              facets={facets}
              tone={tone}
              tableId={TABLE_ID}
              labelWidth={170}
              axis={{ kind: "linear", zero: true, title: "ns per operation", format: (v) => v.toFixed(2) }}
              renderValue={(_r, c) => ns(c.value)}
              label={`Time per operation in each build, ${entry.engine}`}
            />
          </Figure>
        </Section>

        <Section id="locks">
          <Figure
            n={2}
            title={figureTitle(findings, 2)}
            subtitle={`Time ratios paired by round, in ${entry.engine}: median, 95% CI and min–max of ${plural(n, "round")}. Above 1, the first takes longer.`}
            legend={ratioLegend}
          >
            <DotRange
              rows={lockRows}
              facets={facets}
              tone={tone}
              labelWidth={230}
              rangeName="95% CI"
              axis={ratioAxis("time ratio (log scale)")}
              renderValue={(_r, c) => <span className={c.highlight ? "font-semibold text-ink" : undefined}>{c.value.toFixed(2)}</span>}
              renderTip={ratioTip}
              label={`Mutex against RefCell in each build, ${entry.engine}`}
            />
          </Figure>
        </Section>

        <Section id="builds">
          {others.length ? (
            <Figure
              n={3}
              title={figureTitle(findings, 3)}
              subtitle={`Each workload's time in a build ÷ its time in the default (panic=abort) build, paired by round, in ${entry.engine}. RefCell is the control.`}
              legend={ratioLegend}
            >
              <DotRange
                rows={buildRows}
                facets={others.map((v) => ({ id: v, title: `${variantInfo[v].label} ÷ abort` }))}
                tone={tone}
                labelWidth={170}
                rangeName="95% CI"
                axis={ratioAxis("build ÷ default build (log scale)")}
                renderValue={(_r, c) => <span className={c.highlight ? "font-semibold text-ink" : undefined}>{c.value.toFixed(2)}</span>}
                renderTip={ratioTip}
                label={`Each build against the default build, ${entry.engine}`}
              />
            </Figure>
          ) : (
            <Prose>
              <p>{entry.engine} loaded only the default build, so there is no build to compare with it.</p>
            </Prose>
          )}
        </Section>

        <Section id="table">
          <DataTable
            id={TABLE_ID}
            caption={`${entry.engine}: median ns per operation; under it, the paired ratio to the workload's baseline row in the same build. Bold clears the threshold.`}
            columns={columns}
            rows={shownWorkloads}
            rowKey={(w) => w.id}
            group={(w) => w.group}
            groupHeading={(w) => groupInfo[w.group].title}
            tone={tone}
            footnote={
              <>
                {pending.length ? <p>Not yet reproduced in a second capture, so not a main point: {pending.map((c) => c.text).join(" ")}</p> : null}
                <p>
                  {row.iterations} iterations per call; {listText(measured.map((v) => variantInfo[v].label))} measured in the same rounds.
                </p>
              </>
            }
          />
        </Section>

        <MeasurementNotes
          edition={showMine ? undefined : current?.edition}
          provenance={
            showMine
              ? [runDate(mine.startedAt), mine.context?.browser ?? "this browser", ...(hardware().platform ? [hardware().platform] : []), `${plural(n, "round")} per cell`]
              : editionProvenance(current!.edition, { browsers: listText(entries.map((e) => e.engine)), samples: `${plural(n, "round")} per cell` })
          }
          per="cell"
          items={notes}
          rawHref={showMine ? undefined : current?.rawHref}
          libraries={[]}
        />

        <LocksMeasure refRun={current?.run} mine={mine} onShowRun={() => setDataset("mine")} />
        <ResultsTarget>{session.announcement}</ResultsTarget>
      </ReleaseBody>
    </HighlightScope>
  );
};

/** No reference capture (or every one withheld) and no run here yet: what the page measures, and the Measure section. */
const Empty = ({ note, edition }: { note: string; edition?: string }) => {
  const session = useLocksSession();
  return (
    <HighlightScope>
      <ReleaseHeader measure title={TITLE} meta={edition ? [{ label: "Reference edition", value: edition }] : []} notice={note ? <ReleaseNotice>{note}</ReleaseNotice> : undefined} />
      <ReleaseBody
        sections={[
          { id: "points", title: "Main points" },
          { id: "measure", title: "Measure on this machine" },
        ]}
      >
        <Section id="points">
          <MainPoints
            tone="accent"
            points={[]}
            empty={
              <>
                {note ? "The reference captures disagreed with their repeats, so nothing is shown until they are recaptured." : "There is no reference capture yet."} You can measure
                in this browser below: every workload in the default, panic=unwind and +atomics builds.
              </>
            }
          />
        </Section>
        <LocksMeasure />
        <ResultsTarget>{session.announcement}</ResultsTarget>
      </ReleaseBody>
    </HighlightScope>
  );
};

/** "Measure on this machine": the run form, progress, outcome, exports and the run picker. */
const LocksMeasure = ({ refRun, mine, onShowRun }: { refRun?: ResultRow; mine?: ResultRow; onShowRun?: () => void }) => {
  const session = useLocksSession();
  const activeRun = useActiveRun();
  const { results, progress, sampleCount } = session;
  const running = activeRun === "locks";
  const samplesError = integerError(sampleCount, MIN_ROUNDS, MAX_ROUNDS);
  const otherRunning = activeRun !== null && activeRun !== "locks";
  const disabledReason = otherRunning ? <OtherRunning benchmark={activeRun} /> : samplesError ? "Fix the highlighted field to run." : undefined;
  const latest = results[0];
  const outcome: RunOutcome | undefined = session.error
    ? { kind: "failed", message: [session.error, recovery(session.error)].filter(Boolean).join("; ") }
    : session.cancelled
      ? { kind: "cancelled", measured: 0, total: variants.length, unit: "builds", message: "Cancelled. A run is kept only when every round finishes, so any rounds measured were discarded; the results shown are unchanged." }
      : latest && !latest.checksumsMatch
        ? { kind: "mismatch", what: "the builds", message: "The builds computed different digests, so this run is not a valid comparison." }
        : latest && latest.variants.length < variants.length
          ? { kind: "partial", measured: latest.variants.length, total: variants.length, unit: "builds", reason: variants.filter((v) => latest.skipped[v]).map((v) => `${variantInfo[v].label} ${latest.skipped[v]}.`).join(" ") }
          : latest
            ? { kind: "done", measured: latest.variants.length, unit: "builds" }
            : undefined;
  const PREP = 3;
  const fraction = progress ? (progress.prep * PREP + progress.completed) / (PREP + progress.total) : 0;
  return (
    <MeasureSection
      intro={<p>Run every workload in every build this browser can load. A run takes about a minute at 10 rounds.</p>}
      run={{ label: "Run all builds", onRun: () => startRun(), disabled: otherRunning || Boolean(samplesError), disabledReason }}
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
      exports={mine ? <LocksExport row={mine} /> : <span className="text-ink-3">Export after a run: CSV, JSON, Markdown</span>}
      samples={
        <div className="flex flex-wrap items-center gap-2.5 text-sm text-ink-2">
          <NumberInput
            id="locks-samples"
            aria-label="Rounds"
            min={MIN_ROUNDS}
            max={MAX_ROUNDS}
            value={sampleCount}
            onValueChange={setSampleCount}
            disabled={running}
            aria-invalid={samplesError ? true : undefined}
            aria-describedby={samplesError ? "locks-samples-hint" : undefined}
            className={numberFieldClass}
          />
          <label htmlFor="locks-samples">
            rounds, each timing every workload in every build. A 95% CI needs at least {MIN_ROUNDS}
            {refRun ? `; the reference used ${samplesOf(refRun, "abort", "op/plain")?.length ?? "?"}` : ""}.
          </label>
          {samplesError ? (
            <span id="locks-samples-hint" className="basis-full text-danger">
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
            options={results.map((r) => ({ value: String(r.id), label: `Run ${r.id}`, detail: `${r.variants.length} builds, ${plural(samplesOf(r, "abort", "op/plain")?.length ?? 0, "round")}` }))}
          />
          <p className="mt-2 text-sm text-ink-2">Newest first. The one chosen is what This machine shows.</p>
        </MeasureRow>
      ) : null}
    </MeasureSection>
  );
};

const LocksExport = ({ row }: { row: ResultRow }) => {
  const measured = variants.filter((v) => row.variants.includes(v));
  const lines = measured.flatMap((v) => measuredWorkloads(row).map((w) => ({ v, w, st: summarize(samplesOf(row, v, w.id)!), e: baselineEffect(row, v, w.id) })));
  return (
    <ExportButtons
      baseName={`locks-run-${row.id}-${fileDate(row.startedAt)}`}
      json={() =>
        JSON.stringify(
          {
            benchmark: "locks",
            scope: "this run",
            userAgent: navigator.userAgent,
            ...hardware(),
            build: { ...build, toolchain: locksBuild() },
            method: { minSampleMs: MIN_SAMPLE_MS, order: "rotate", paired: true, unit: "ns per operation", statistic: "median; paired ratios with order-statistic 95% CI" },
            run: row,
            summary: runClaim(row),
          },
          null,
          2,
        )
      }
      csv={() =>
        toCSV(
          ["run", "build", "workload", "baseline", "median_ns", "min_ns", "max_ns", "rounds", "calls_per_batch", "iterations_per_call", "ratio_to_baseline", "ratio_ci_lo", "ratio_ci_hi", "checksums_match", "toolchain"],
          lines.map(({ v, w, st, e }) => [row.id, v, w.id, w.baseline, st.median, st.min, st.max, st.n, row.calls[w.id], row.iterations, e?.median, e?.ci?.lo, e?.ci?.hi, row.checksumsMatch, locksBuild()]),
        )
      }
      markdown={() =>
        `${row.context?.browser ?? navigator.userAgent}; ${hardware().hardwareConcurrency ?? "?"} logical cores; ${hardware().platform ?? "unknown platform"}.\nBuild: ${locksBuild()}.\n\n` +
        toMarkdown(
          ["Workload", ...measured.map((v) => `${variantInfo[v].label} ns/op`)],
          measuredWorkloads(row).map((w) => [
            w.id,
            ...measured.map((v) => {
              const { st, e } = lines.find((l) => l.v === v && l.w.id === w.id)!;
              return `${st.median.toFixed(3)}${e ? ` (${e.median.toFixed(2)}× ${w.baseline}, ${effectWords(e)})` : ""}`;
            }),
          ]),
          [false, ...measured.map(() => true)],
        ) +
        "\n"
      }
    />
  );
};
