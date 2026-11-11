import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/Button";
import { integerError, NumberInput, numberFieldClass } from "@/components/Field";
import { FileButton } from "@/components/FileInput";
import { UploadIcon } from "@/components/icons";
import {
  BrowserSwitch,
  ChoiceChips,
  Cited,
  DatasetSwitch,
  editionProvenance,
  Figure,
  HighlightScope,
  keepTogether,
  MainPoints,
  MeasurementNotes,
  MeasureSection,
  monthOf,
  type NoteItem,
  ReleaseBody,
  ReleaseHeader,
  ReleaseNotice,
  ResultsTarget,
  type RunOutcome,
  runDate,
  Section,
  sourceLine,
  Switch,
  useDataset,
  useSupport,
} from "@/components/release";
import { useFileDrop } from "@/hooks";
import { facets, withheld } from "@/data/editions";
import { MIN_SAMPLE_MS, MIN_WARMUP_MS, MIN_WARMUP_ROUNDS, MAX_WARMUP_ROUNDS } from "@/lib/bench";
import { buildSummary } from "@/lib/build";
import { isExploratory } from "@/lib/evidence";
import { type Finding, listText, machineLabel, mainPoints, relativeSentence, relativeTo, withheldNote } from "@/lib/findings";
import { formatBytes, plural } from "@/lib/format";
import { benchmarkNames, benchmarkRoutes, useActiveRun } from "@/lib/runRegistry";
import { families, familyInfo, type Family, formatInfo, formats, implementationsOf, plannedConfigs, supportsCompressionStreams } from "./codecs";
import { BandMap } from "./BandMap";
import { BrowserFigure } from "./BrowserFigure";
import { corpora, corpusInfo, type CorpusId, inputName, isCorpusId } from "./corpora";
import { cellBands, pointFigures, STREAM_ALLOWANCE } from "./findings";
import { engineRatios } from "./points";
import { CodeFigure, ConfigTable, DecoderFigure, RelativeFigure, type View } from "./figures";
import { TransferFigure } from "./TransferFigure";
import { S3_STORAGE } from "./transfer";
import { rawHref } from "./rawData";
import {
  allCaptures,
  cellOf,
  editionStrips,
  editionSummary,
  engineGroups,
  FIGURES,
  IMPL_FORMATS,
  mineCell,
  mineFindings,
  QUESTIONS,
  reference,
  REFERENCE_BROWSER,
  REFERENCE_MACHINE,
  referenceFindings,
  shownCaptures,
  stripOf,
} from "./release";
import { type Row, resultRows, samplesCollected } from "./results";
import { ResultsExport } from "./ResultsExport";
import { cancelRun, markViewed, setNotice, setSamples, setSource, startRun, useCompressionSession } from "./session";
import { useEnabled, useUiActions } from "./store";
import type { CompressionRun } from "./types";

const SUBJECT = "Compression codecs in WebAssembly, Silesia corpus subset";
/** The crates and packages this page measures, for Measurement notes. */
const LIBRARIES = ["lz4_flex", "zstd", "miniz_oxide", "zune-inflate", "libdeflater", "zlib-rs", "brotli", "pako", "fflate"] as const;

/** "Chrome 156" → "chrome"; Edge and others are not a captured engine. */
const browserIdOf = (name: string | undefined) => {
  const first = name?.split(" ")[0].toLowerCase();
  return first === "chrome" || first === "firefox" || first === "safari" ? first : undefined;
};
const majorVersion = (v: string) => v.split(".")[0];
/** A captured browser by id or name, with its major version: "Chrome 156". */
const engineLabel = (id: string) => {
  const e = allCaptures.find((x) => x.browser.id === id || x.browser.name === id);
  return e ? `${e.browser.name} ${majorVersion(e.browser.version)}` : id;
};

const levelsOf = (family: Family) => {
  const info = familyInfo[family];
  if (info.decodesFrom) {
    return "decode only";
  }
  const levels = info.levels.filter((l): l is number => l !== null);
  return levels.length ? `levels ${levels.join(", ")}` : "default level";
};

/** Rows with at least one decompression sample. */
const measuredRows = (rows: Row[]) => rows.filter((r) => r.decode);

/** How the visitor's last run ended, for the measure section. */
function outcomeOf(run: CompressionRun | undefined): RunOutcome | undefined {
  if (!run || run.status === "running") {
    return undefined;
  }
  const rows = resultRows(run);
  const measured = measuredRows(rows).length;
  const total = rows.length;
  const unit = "configurations";
  const failed = rows.filter((r) => r.roundTrip === false);
  if (failed.length) {
    return { kind: "mismatch", what: listText(failed.map((r) => r.label)) };
  }
  switch (run.status) {
    case "done":
      return { kind: "done", measured, unit };
    case "cancelled": {
      // Every configuration has samples, just fewer rounds than planned: say how many rounds.
      const rounds = samplesCollected(rows);
      return { kind: "cancelled", measured, total, unit, rounds: measured === total && rounds < run.samples ? { measured: rounds, total: run.samples } : undefined };
    }
    case "error":
      return measured > 0
        ? { kind: "partial", measured, total, unit, reason: `it stopped with an error: ${run.error ?? "unknown"}` }
        : { kind: "failed", message: run.error ?? "unknown error" };
  }
}

/** Up to three main points (`pointFigures`), shown in figure order. */
const pointsOf = (findings: readonly Finding[]) => {
  const order = pointFigures(IMPL_FORMATS);
  const picked = new Set(
    order
      .filter((n) => findings.some((f) => f.figure === n && f.claim))
      .slice(0, 3),
  );
  return mainPoints(findings.filter((f) => picked.has(f.figure)));
};

/** Notes on the codecs and the transfer model: the same for the reference and this machine. */
const codecItems: NoteItem[] = [
  {
    term: "Codecs",
    detail: (
      <>
        Each library&apos;s one-shot API at the levels shown, with its default window and settings; zstd with long-distance matching is
        off by default. Formats, as implementation (container):{" "}
        {formats
          .map((fmt) => `${formatInfo[fmt].name}: ${implementationsOf(fmt).map((x) => `${familyInfo[x].name} (${familyInfo[x].container})`).join(", ")}`)
          .join("; ")}
        . Every decoded output was checked byte for byte against the input before timing.
      </>
    ),
  },
  {
    term: "Throughput",
    detail: "MB/s of uncompressed data in both directions; 1 MB = 10⁶ bytes. Ratio is original ÷ compressed size, exact for a given input.",
  },
  {
    term: "Time per file",
    detail: `Figures ${FIGURES.downloadMap}, ${FIGURES.uploadMap}, ${FIGURES.download} and ${FIGURES.upload} add measured times to a modelled transfer: compressed bytes ÷ bandwidth plus the median decompression time (download), or the median compression time plus compressed bytes ÷ bandwidth (upload); uncompressed is original bytes ÷ bandwidth. 1 Mbps = 10⁶ bits per second, steady; latency is ignored and nothing overlaps, as streaming would. Server-side compression on the fly is not modelled. A configuration is named fastest over a band only where it beats the next by more than 3% in every capture; stated bandwidths are round values inside that band. Claims are of the levels tested: static files often use higher ones (brotli 11, zstd 19+). Times are the payload's alone, with codecs loaded; Browser gzip is CompressionStream and DecompressionStream. Slower devices move crossovers lower.`,
  },
  {
    term: "Storage",
    detail: `Figure ${FIGURES.upload}'s storage column is what it costs to keep 1 TB (10¹² bytes) of original data stored compressed that way: one copy, one month, in ${S3_STORAGE.what} at $${S3_STORAGE.perGiBMonth} per GiB-month (AWS bills GB = 2³⁰ bytes; ${S3_STORAGE.url}, checked ${S3_STORAGE.checked}); uncompressed is $21.42. "vs previous winner" compares sizes with the winner of the next lower band. Replicas and other storage classes change it; request charges don't depend on compression and are left out. Storage depends on the client's compressed size if the server keeps those bytes; recompression changes the stored size. If stored bytes are served back out, S3 egress, charged on each download, typically costs more per byte than a month of storage. Validating client-compressed uploads: cap the compressed size, the decoder's memory (the zstd window, say) and CPU time; allow listed formats only; hash and scan after decompressing.`,
  },
  ...(FIGURES.browsers !== undefined
    ? [
        {
          term: "Speed relative to Chrome",
          detail: `Figure ${FIGURES.browsers} divides each configuration's median speed in Firefox or Safari by its median in Chrome on the same machine, capture 1 with capture 1 and capture 2 with capture 2. Dots are the median of those ratios over every input, level and capture; lines span them all.`,
        },
      ]
    : []),
  {
    term: "About the same",
    detail:
      "Configurations run one after another, round-aligned. The figures compare them by their medians (not paired). Two times are about the same when their medians are less than 3% apart. A configuration is fastest only when the next takes more than 3% longer, with the same winner, in every capture. Ranges are the observed min–max, not confidence intervals.",
  },
  {
    term: "Fastest decoders",
    detail: `Each decoder reads its own library's output (zune-inflate reads miniz_oxide's). In a separate test (six decoders on five encoders' raw-deflate streams, dickens and x-ray, Node 26 on an Apple M4 Pro), the stream alone moved one decoder's speed up to about 1.2× at level 6, and up to 1.7× at level 1, so two decoders can sit up to 1.2² ≈ ${STREAM_ALLOWANCE}× apart from their streams alone. Decoders are compared at level 6: a group is clearly fastest only when even its slowest is more than ${STREAM_ALLOWANCE}× faster than the next decoder, in both captures; its members are within ${STREAM_ALLOWANCE}× of its fastest.`,
  },
];

export const Compression = () => {
  const session = useCompressionSession();
  const enabled = useEnabled();
  const { setEnabled, setAll } = useUiActions();
  const streamSupport = useSupport(supportsCompressionStreams);
  const activeRun = useActiveRun();
  const running = activeRun === "compression";
  const otherRunning = activeRun !== null && !running;

  // --- Reference selection ------------------------------------------------
  const f = useMemo(() => facets(allCaptures), []);
  const inputs = corpora.filter((c) => f.inputs.includes(c.id));
  const [input, setInput] = useState<CorpusId>("dickens");
  const [browser, setBrowser] = useState<string>(REFERENCE_BROWSER);

  // The details show one input in one browser on the reference machine: every captured browser is a choice.
  const browsersHere = shownCaptures.filter((e) => e.input === input && e.machine.id === REFERENCE_MACHINE && e.repeat.index === 1);
  const shownBrowser = browsersHere.some((e) => e.browser.id === browser) ? browser : REFERENCE_BROWSER;
  const sel = useMemo(() => reference(input, shownBrowser, REFERENCE_MACHINE), [input, shownBrowser]);
  const primary = sel.primary;
  const refFindings = useMemo(() => referenceFindings(sel), [sel]);
  // Across inputs and browsers: the edition's strips and every implementation's speed against the reference browser.
  const strips = useMemo(() => {
    // Inputs in the Input switch's order.
    const order = (x: { input: string }) => corpora.findIndex((c) => c.id === x.input);
    const of = (sc: "download" | "upload") => editionStrips(sc, REFERENCE_MACHINE).sort((p, q) => order(p) - order(q));
    return { download: of("download"), upload: of("upload") };
  }, []);
  const groups = useMemo(() => engineGroups().filter((g) => g.machine === REFERENCE_MACHINE), []);
  const ratios = useMemo(() => (IMPL_FORMATS.length ? engineRatios(groups, [IMPL_FORMATS[0]]) : []), [groups]);

  // --- This machine ---------------------------------------------------------
  // The newest finished run with a measurement; a run in progress stays
  // off the figures until it ends.
  const mineRun = session.runs.find((r) => r.status !== "running" && resultRows(r).some((x) => x.decode));
  const hasMine = mineRun !== undefined;
  const [dataset, setDataset] = useDataset(mineRun?.id, session.viewedRun, markViewed);
  const mine = dataset === "mine" && hasMine;
  const latest = session.runs[0];

  const mineData = useMemo(() => {
    if (!mineRun) {
      return undefined;
    }
    const browserName = mineRun.context?.browser ?? "this browser";
    const all = resultRows(mineRun);
    const rows = measuredRows(all);
    const collected = samplesCollected(rows);
    const cell = { ...mineCell(mineRun, `${browserName} on this machine`), rows };
    const findings = isExploratory(collected) ? [] : mineFindings(cell);
    // The reference to compare with: the same input, in the visitor's own
    // engine when it was captured, else the reference engine.
    const corpus = mineRun.synthetic && isCorpusId(mineRun.filename) ? mineRun.filename : undefined;
    const own = browserIdOf(browserName);
    const refSel = corpus
      ? [reference(corpus, own ?? REFERENCE_BROWSER, REFERENCE_MACHINE), reference(corpus, REFERENCE_BROWSER, REFERENCE_MACHINE)].find((x) => x.primary)
      : undefined;
    const refCap = refSel?.primary;
    const refRows = refSel?.primary ? resultRows(refSel.primary.raw) : [];
    const speed = (r: Row) => (r.encode && r.decode ? Math.sqrt(r.encode.median * r.decode.median) : r.decode?.median);
    const pick = (rs: Row[]) => Object.fromEntries(rs.flatMap((r) => (speed(r) ? [[r.id, speed(r)!]] : [])));
    const rel = refCap && !isExploratory(collected) ? relativeTo(pick(refRows), pick(rows)) : undefined;
    return { run: mineRun, browserName, own, all, rows, cell, collected, findings, refCap, rel };
  }, [mineRun]);

  // --- The view the figures draw --------------------------------------------
  const view: View | undefined = useMemo(() => {
    if (mine && mineData) {
      const { run, rows, collected } = mineData;
      return {
        mine: true,
        rows,
        input: inputName(run),
        samples: collected,
        partial: rows.length < mineData.all.length ? { measured: rows.length, total: mineData.all.length } : undefined,
        exploratory: isExploratory(collected),
      };
    }
    if (!primary) {
      return undefined;
    }
    const rows = resultRows(primary.raw);
    return {
      mine: false,
      rows,
      input: primary.input ?? "",
      samples: samplesCollected(rows),
      exploratory: false,
    };
  }, [mine, mineData, primary]);
  const findings: Finding[] = mine && mineData ? mineData.findings : refFindings;
  // This machine: one strip, the visitor's input in the visitor's browser; nothing gated from one sample.
  const shownStrips = useMemo(() => {
    if (mine && mineData) {
      const one = (sc: "download" | "upload") => [{ ...stripOf(mineData.cell, [], sc, !isExploratory(mineData.collected)), input: inputName(mineData.run), engine: mineData.browserName }];
      return { download: one("download"), upload: one("upload") };
    }
    return strips;
  }, [mine, mineData, strips]);
  // The time-against-bandwidth figures' band tables: winners that hold in every capture shown (this machine: in its one run).
  const transfer = useMemo(() => {
    if (mine && mineData) {
      return { download: cellBands(mineData.cell, "download"), upload: cellBands(mineData.cell, "upload"), captures: 1 };
    }
    if (!primary) {
      return undefined;
    }
    const p = cellOf(primary);
    const reps = sel.replicates.map((r) => [cellOf(r)]);
    return { download: cellBands(p, "download", reps), upload: cellBands(p, "upload", reps), captures: 1 + reps.length };
  }, [mine, mineData, primary, sel]);
  // With nothing asked (one sample), each figure keeps its neutral title.
  const fig = (n: number): Finding => {
    const q = QUESTIONS.find((x) => x.figure === n)!;
    return findings.find((x) => x.figure === n) ?? { figure: n, title: q.neutral, question: q.question, neutral: q.neutral, tableOnly: [] };
  };
  // Reference points summarise the whole edition (every input, browser and machine), so no switch changes them; this machine's summarise its run.
  const edition = useMemo(() => editionSummary(), []);
  const points = (mine ? pointsOf(findings).map((text, i) => ({ id: `p${i}`, text })) : edition.points.map((p) => ({ id: p.key, text: p.text }))).map((p) => ({
    id: p.id,
    text: <Cited text={p.text} />,
  }));

  // --- Measure on this machine -----------------------------------------------
  const specs = plannedConfigs(enabled, streamSupport !== false);
  const samplesError = integerError(session.samples, 1, 100);
  const blocker =
    specs.length === 0
      ? "Select at least one library to run."
      : samplesError
        ? "Fix the number of samples to run."
        : otherRunning
          ? `${benchmarkNames[activeRun]} is running. Finish or cancel it first.`
          : undefined;
  const { isHovering } = useFileDrop({ onFile: (file) => setSource({ kind: "file", file }), onReject: setNotice, enabled: !running });
  const source = session.source;
  const progress = session.progress;

  // --- Sections ----------------------------------------------------------
  const relative = mine && mineData?.rel ? mineData.rel : undefined;
  const detailTitle = mine && mineData ? `Details for ${inputName(mineData.run)} on this machine` : `Details for ${input} in ${engineLabel(shownBrowser)}`;
  const sections = [
    { id: "points", title: "Main points" },
    { id: "across", title: mine ? "Across bandwidths and browsers" : "Across inputs and browsers" },
    { id: "details", title: detailTitle },
    ...(relative ? [{ id: "relative", title: "Against the reference" }] : []),
    { id: "measure", title: "Measure on this machine" },
  ];

  // --- Header -------------------------------------------------------------
  const editionMonth = primary ? monthOf(primary.id) : "";
  const missingEngines = f.browsers.filter((b) => b !== REFERENCE_BROWSER && !browsersHere.some((e) => e.browser.id === b));
  // The drift gate's note on this input: an engine whose two captures disagreed is not shown.
  const held = withheld(allCaptures, { machine: REFERENCE_MACHINE, input });
  const heldNote = withheldNote(held);
  const heldBrowsers = new Set(held.map((w) => w.browser as string));
  const missing = missingEngines.filter((b) => !heldBrowsers.has(b)).map((b) => allCaptures.find((e) => e.browser.id === b)?.browser.name ?? b);
  const editionBrowsers = listText(f.browsers.map((b) => engineLabel(b)));

  const meta =
    mine && mineData
      ? [
          { label: "This machine", value: `${mineData.browserName}${mineData.run.context?.cores ? ` · ${mineData.run.context.cores} logical cores` : ""}` },
          { label: "Input", value: `${inputName(mineData.run)} · ${formatBytes(mineData.run.bytes)}` },
          { label: "Samples", value: `${mineData.collected} per configuration${mineData.collected < mineData.run.samples ? ` (of ${mineData.run.samples} planned)` : ""}` },
        ]
      : primary
        ? [
            { label: "Reference machine", value: machineLabel(primary.machine) },
            { label: "Samples", value: `${primary.method.samples} per configuration, ${sel.replicates.length + 1} captures` },
          ]
        : [];

  const ownFile = mineData && !mineData.refCap;
  const confounded = mineData?.refCap && mineData.own !== mineData.refCap.browser.id;
  const mineNotice = !mineData
    ? null
    : ownFile
      ? `${inputName(mineData.run)} has no reference, so these results stand alone.`
      : confounded
        ? `This browser is ${mineData.browserName}, the reference ${mineData.refCap!.browser.name} on ${mineData.refCap!.machine.cpuModel}, so engine and machine are confounded.`
        : null;
  const notice = mine ? mineNotice : null;

  // --- Notes ---------------------------------------------------------------
  const referenceItems: NoteItem[] = primary
    ? [
        ...codecItems,
        ...(missing.length ? [{ term: "Engines", detail: `${listText(missing)} ${missing.length === 1 ? "was" : "were"} not measured on ${input}.` }] : []),
        {
          term: "Reproduction",
          detail:
            sel.replicates.length === 0
              ? `A finding becomes a figure title or main point only when a second, independent capture reproduces it. This edition has one capture of ${input} in ${primary.browser.name} so far.`
              : "A finding becomes a figure title or main point only where every capture makes it; the details show capture 1.",
        },
      ]
    : [];
  const mineItems: NoteItem[] = mineData
    ? [
        {
          term: "Conditions",
          detail: (
            <>
              {mineData.browserName}
              {mineData.run.context?.cores ? `, ${mineData.run.context.cores} logical cores` : ""};{" "}
              {mineData.run.context?.crossOriginIsolated ? "cross-origin isolated" : "not cross-origin isolated"}
              {mineData.run.context ? `, timer step ${+(mineData.run.context.timerMs * 1000).toFixed(1)} µs` : ""}. Started{" "}
              {new Date(mineData.run.startedAt).toLocaleString("en-GB")}.
            </>
          ),
        },
        {
          term: "Method",
          detail: `${plural(mineData.run.samples, "sample")} planned per configuration, each a batch of at least ${MIN_SAMPLE_MS} ms divided by its repetitions, after an untimed warm-up of at least ${MIN_WARMUP_MS} ms and ${MIN_WARMUP_ROUNDS} rounds (at most ${MAX_WARMUP_ROUNDS}). Each round visits every configuration once, in an order rotated by one per round.`,
        },
        { term: "Build", detail: buildSummary() },
        ...codecItems,
      ]
    : [];

  const exportsNode =
    mineData && !running ? (
      <ResultsExport run={mineData.run} rows={resultRows(mineData.run)} exploratory={isExploratory(mineData.collected)} />
    ) : (
      <span className="text-ink-3">Export after a run: JSON, CSV</span>
    );

  const failed = view?.rows.filter((r) => r.roundTrip === false) ?? [];
  const tableFoot = view ? (
    <>
      {failed.length ? (
        <span className="text-danger">
          {listText(failed.map((r) => r.label))} did not round-trip: the decoded output differed from the input. Left out of the figures.{" "}
        </span>
      ) : (
        `All ${plural(view.rows.filter((r) => r.roundTrip === true).length, "configuration")} round-tripped byte for byte. `
      )}
      {view.rows.some((r) => r.decodeOnly) ? "† zune-inflate decodes miniz_oxide 6's output, so it shows that ratio. " : null}
      {view.rows.some((r) => r.code?.source === "published") ? "* Published JavaScript build. " : null}
      {mine && mineData ? (
        <>
          Export: <a href="#measure">JSON or CSV</a> under Measure on this machine.
        </>
      ) : null}
    </>
  ) : undefined;

  const pointsEmpty = mine
    ? mineData && isExploratory(mineData.collected)
      ? "With one sample per configuration nothing is compared. The figures and table show every value."
      : "No finding cleared the threshold on this run. The figures and table show every value."
    : "No finding held in every capture of this edition, so none is stated.";

  return (
    <HighlightScope>
      {isHovering ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-[6px] border-2 border-dashed border-accent bg-bg/90"
        >
          <p className="flex items-center gap-3 text-fig font-semibold text-ink">
            <UploadIcon className="size-6 text-accent" />
            Drop to measure this file
          </p>
        </div>
      ) : null}
      <ReleaseHeader
        measure
        title={mine ? "Compression codecs in WebAssembly, on this machine" : `${SUBJECT}${editionMonth ? `: ${editionMonth}` : ""}`}
        meta={meta}
        switches={hasMine ? <DatasetSwitch value={mine ? "mine" : "reference"} onChange={setDataset} hasMine={hasMine} hint={ownFile ? "Own file: no reference to compare" : undefined} /> : null}
        notice={notice ? <ReleaseNotice>{keepTogether(notice)}</ReleaseNotice> : null}
      />
      <ReleaseBody sections={sections}>
        <Section id="points">
          <MainPoints tone={mine ? "mine" : "accent"} points={points} empty={pointsEmpty} />
          {mine && mineData && points.length > 0 && primary && mineData.rows.length < resultRows(primary.raw).length ? (
            <p className="mt-4 max-w-measure text-ink-2">These points cover only the {plural(mineData.rows.length, "configuration")} this run measured.</p>
          ) : null}
          {relative ? (
            <p className="mt-4 max-w-measure text-ink-2">
              {/* One parenthesis, the citation: the geometric mean's range is the relative figure's. */}
              {relativeSentence(relative, "This machine", `the ${mineData!.refCap!.browser.name} reference`).replace(/ \(geometric mean over ([^;)]*)[^)]*\)\.$/, ", a geometric mean over $1")} (
              <a href={`#figure-${FIGURES.relative}`} className="link">
                Figure {FIGURES.relative}
              </a>
              ).
            </p>
          ) : null}
        </Section>

        {view ? (
          <>
            <Section id="across">
              {(["download", "upload"] as const).map((sc) => (
                <Figure
                  key={sc}
                  n={sc === "download" ? FIGURES.downloadMap : FIGURES.uploadMap}
                  title={sc === "download" ? "Fastest download, by bandwidth" : "Fastest upload, by bandwidth"}
                  subtitle={`${sc === "download" ? "Download and decompress" : "Compress and upload"} one file. Colour marks the fastest of the levels tested, by over 3%${mine ? "" : " in both captures"}.`}
                >
                  <BandMap
                    strips={shownStrips[sc]}
                    scenario={sc}
                    engineName={(x) => (mine ? x.engine : engineLabel(x.engine))}
                    label={`Fastest ${sc} configuration by bandwidth, ${mine ? "this machine" : "for each input and browser"}`}
                  />
                </Figure>
              ))}
              {FIGURES.browsers !== undefined && ratios.length ? (
                <BrowserFigure
                  n={FIGURES.browsers}
                  format={IMPL_FORMATS[0]}
                  ratios={ratios}
                  base={engineLabel(REFERENCE_BROWSER)}
                  inputs={new Set(groups.map((g) => g.input)).size}
                  source={mine ? `The reference edition, ${editionBrowsers} on ${allCaptures[0] ? machineLabel(allCaptures[0].machine) : "the reference machine"}` : undefined}
                />
              ) : null}
              <CodeFigure n={FIGURES.code} view={view} finding={fig(FIGURES.code)} />
            </Section>

            <Section id="details" className="sm:[&_figure]:scroll-mt-[96px]">
              {mine ? null : (
                <div className="z-20 -mx-1 mb-4 flex sm:sticky sm:top-0 flex-wrap items-end gap-x-8 gap-y-2 border-b border-tint-rule bg-tint px-3 py-2.5 sm:mx-0">
                  <Switch<CorpusId>
                    label="Input"
                    value={input}
                    onChange={setInput}
                    options={inputs.map((c) => ({ value: c.id, label: c.label, detail: formatBytes(c.bytes) }))}
                  />
                  {browsersHere.length > 1 ? (
                    <BrowserSwitch<string>
                      value={shownBrowser}
                      onChange={setBrowser}
                      options={browsersHere
                        .map((e) => ({ value: e.browser.id as string, label: `${e.browser.name} ${majorVersion(e.browser.version)}` }))
                        .sort((a, b) => f.browsers.indexOf(a.value as never) - f.browsers.indexOf(b.value as never))}
                    />
                  ) : null}
                </div>
              )}
              {!mine && heldNote ? <p className="mb-4 max-w-measure text-sm text-ink-2">{keepTogether(heldNote)}</p> : null}
              {(["download", "upload"] as const).map((sc) => (
                <TransferFigure key={sc} n={FIGURES[sc]} scenario={sc} view={view} finding={fig(FIGURES[sc])} bands={transfer?.[sc] ?? []} captures={transfer?.captures ?? 1} />
              ))}
              {FIGURES.impl.map((p) => (
                <DecoderFigure key={p.format} n={p.decode} format={p.format} view={view} finding={fig(p.decode)} />
              ))}
              <div className="mt-[52px]">
                <ConfigTable view={view} footnote={tableFoot} />
              </div>
            </Section>

            {relative && mineData ? (
              <Section id="relative">
                <RelativeFigure n={FIGURES.relative} rel={relative} rows={view.rows} source={`Compared with ${sourceLine(mineData.refCap!, "configuration")}`} />
              </Section>
            ) : null}
          </>
        ) : null}

        {mine && mineData ? (
          <MeasurementNotes
            items={mineItems}
            libraries={LIBRARIES}
            provenance={[runDate(mineData.run.startedAt), mineData.browserName, `${plural(mineData.collected, "sample")} per configuration`]}
          />
        ) : (
          <MeasurementNotes
            edition={primary}
            items={referenceItems}
            rawHref={primary ? rawHref(primary) : undefined}
            libraries={LIBRARIES}
            per="configuration"
            provenance={primary ? editionProvenance(primary, { browsers: editionBrowsers, samples: `${primary.method.samples} samples per configuration, ${sel.replicates.length + 1} captures` }) : undefined}
          />
        )}

        <MeasureSection
          intro={<p>Run the same configurations on a Silesia file or your own. Outputs are checked byte for byte before timing.</p>}
          input={
            <div className="space-y-3">
              <ChoiceChips<CorpusId>
                label="Reference file"
                value={source.kind === "corpus" ? source.id : ("" as CorpusId)}
                onChange={(id) => setSource({ kind: "corpus", id })}
                disabled={running}
                options={corpora.map((c) => ({ value: c.id, label: c.label, detail: formatBytes(c.bytes) }))}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2">
                <FileButton variant="secondary" size="sm" disabled={running} onFile={(file) => setSource({ kind: "file", file })}>
                  <UploadIcon />
                  {source.kind === "file" ? "Choose another file" : "Choose your own file"}
                </FileButton>
                <span className="pointer-coarse:hidden">or drop one anywhere on this page.</span>
              </div>
              <p className="text-sm text-ink-2" aria-live="polite">
                {source.kind === "file" ? (
                  <>
                    Selected: <b className="font-semibold text-ink">{source.file.name}</b>, {formatBytes(source.file.size)}. Your file is compressed
                    and decompressed by every configuration; it has no reference to compare against.
                  </>
                ) : (
                  <>
                    {corpusInfo(source.id).label}: {corpusInfo(source.id).description}.
                  </>
                )}
              </p>
              {session.sourceError ? (
                <p role="alert" className="text-sm font-semibold text-danger">
                  {session.sourceError}
                </p>
              ) : null}
              {session.notice ? (
                <p role="alert" className="text-sm text-danger">
                  That drop wasn't used: {session.notice}{" "}
                  <Button variant="quiet" size="sm" onClick={() => setNotice(null)}>
                    Dismiss
                  </Button>
                </p>
              ) : null}
            </div>
          }
          configurations={
            <fieldset disabled={running} className="min-w-0">
              <legend className="sr-only">Libraries to run</legend>
              <p className="flex flex-wrap items-center gap-x-3 text-sm text-ink-2">
                {plural(specs.length, "configuration")}
                <Button variant="quiet" size="sm" onClick={() => setAll(true)}>
                  Select all
                </Button>
                <Button variant="quiet" size="sm" onClick={() => setAll(false)}>
                  Clear
                </Button>
              </p>
              <ul className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                {families.map((family) => {
                  const info = familyInfo[family];
                  const unsupported = family === "native" && streamSupport === false;
                  return (
                    <li key={family}>
                      <label className="flex cursor-pointer items-baseline gap-2 py-1 text-[0.9375rem] has-disabled:cursor-not-allowed">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 translate-y-[2px] accent-[var(--c-accent)]"
                          checked={enabled[family] && !unsupported}
                          disabled={unsupported}
                          onChange={(e) => setEnabled(family, e.target.checked)}
                        />
                        <span className={unsupported ? "text-ink-3" : "font-semibold text-ink"}>{info.name}</span>
                        <span className="text-xs text-ink-3">
                          {unsupported
                            ? "not available in this browser"
                            : `${levelsOf(family)}${info.runtime === "JS" ? " · JavaScript" : ""}${info.settings && info.optIn ? ` · ${info.settings}` : ""}`}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          }
          samples={
            <div className="flex flex-wrap items-center gap-2.5 text-sm text-ink-2">
              <NumberInput
                id="compression-samples"
                aria-label="Samples per configuration"
                min={1}
                max={100}
                value={session.samples}
                onValueChange={setSamples}
                disabled={running}
                aria-invalid={samplesError ? true : undefined}
                aria-describedby={samplesError ? "compression-samples-error" : undefined}
                className={numberFieldClass}
              />
              <label htmlFor="compression-samples">per configuration. The reference used {primary?.method.samples ?? 10}.</label>
              {samplesError ? (
                <span id="compression-samples-error" className="basis-full text-danger">
                  {samplesError}
                </span>
              ) : null}
            </div>
          }
          run={{
            label: `Run ${plural(specs.length, "configuration")}`,
            onRun: () => void startRun(),
            disabled: blocker !== undefined,
            disabledReason: otherRunning ? (
              <>
                {blocker}{" "}
                <Link className="link" to={benchmarkRoutes[activeRun]}>
                  Go to it
                </Link>
                .
              </>
            ) : (
              blocker
            ),
          }}
          onCancel={running ? cancelRun : undefined}
          running={running}
          progress={
            running
              ? {
                  fraction: progress ? progress.done / progress.total : 0,
                  label: session.cancelling ? "Cancelling" : (progress?.phase ?? "Starting"),
                  detail: progress?.detail,
                }
              : undefined
          }
          outcome={outcomeOf(latest)}
          exports={exportsNode}
        />
        <ResultsTarget>{session.announcement}</ResultsTarget>
      </ReleaseBody>
    </HighlightScope>
  );
};
