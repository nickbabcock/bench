import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { DotRange, EffectPlot, Legend } from "@/components/charts";
import { ExportButtons } from "@/components/ExportButtons";
import { NumberInput, numberFieldClass } from "@/components/Field";
import {
  BrowserSwitch,
  ChoiceChips,
  type Column,
  DataTable,
  type Dataset,
  DatasetSwitch,
  Figure,
  HighlightScope,
  MainPoints,
  MeasureRow,
  MeasureSection,
  MeasurementNotes,
  Prose,
  RawDataLink,
  ReleaseBody,
  ReleaseHeader,
  ReleaseNotice,
  type RunOutcome,
  Section,
  sourceLine,
  Switch,
} from "@/components/release";
import { formatInteger } from "@/lib/format";
import { allocators, compression, type CompressionRow, edition, effects, thisVsRef } from "./fixtures";

const sections = [
  { id: "points", title: "Main points" },
  { id: "dots", title: "Dot and range" },
  { id: "effects", title: "Paired effects" },
  { id: "table", title: "All configurations" },
  { id: "controls", title: "Controls" },
  { id: "measure", title: "Measure on this machine" },
];

const mbps = (v: number) => formatInteger(Math.round(v));
const ratio = (v: number) => `${v.toFixed(2)}×`;
const kb = (v: number) => (v >= 100 ? formatInteger(Math.round(v)) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const us = (v: number) => `${v.toFixed(1)} µs`;

const inputs = [
  { value: "dickens", label: "dickens", detail: "10.2 MB" },
  { value: "xml", label: "xml", detail: "5.3 MB" },
  { value: "x-ray", label: "x-ray", detail: "8.5 MB" },
  { value: "samba", label: "samba", detail: "21.6 MB" },
] as const;
type Input = (typeof inputs)[number]["value"];

const states = ["idle", "running", "done", "partial", "cancelled", "failed", "mismatch"] as const;
type KitState = (typeof states)[number];

const outcomes: Record<Exclude<KitState, "idle" | "running">, RunOutcome> = {
  done: { kind: "done", measured: 21, unit: "configurations" },
  partial: { kind: "partial", measured: 19, total: 21, unit: "configurations", reason: "brotli 9 and zstd 15 hit the time limit" },
  cancelled: { kind: "cancelled", measured: 12, total: 21, unit: "configurations" },
  failed: { kind: "failed", message: "the worker ran out of memory loading samba" },
  mismatch: { kind: "mismatch", what: "zune-inflate" },
};

/** Every release component and chart primitive with fixture data. Unlinked; for page agents and reviewers. */
export function DevKit() {
  const [input, setInput] = useState<Input>("dickens");
  const [dataset, setDataset] = useState<Dataset>("reference");
  const [hasMine, setHasMine] = useState(false);
  const [browser, setBrowser] = useState<"chrome" | "firefox">("chrome");
  const [state, setState] = useState<KitState>("idle");
  const [failedRow, setFailedRow] = useState(false);
  const [samples, setSamples] = useState(5);
  const mine = hasMine && dataset === "mine";
  const tone = mine ? "mine" : "accent";
  // "This machine" in the kit: the fixture at 0.8×, to show the marks glide.
  const rows = useMemo(
    () =>
      mine
        ? compression.map((r) => ({
            ...r,
            enc: r.enc?.map((v) => v * 0.8) as CompressionRow["enc"],
            dec: r.dec.map((v) => v * 0.8) as CompressionRow["dec"],
          }))
        : compression,
    [mine],
  );
  const columns: Column<CompressionRow>[] = [
    {
      id: "codec",
      header: "Codec",
      render: (r, { first }) =>
        first ? (
          <span className="block min-w-[118px] font-semibold sm:min-w-[150px]">
            {r.codec}
            {r.detail ? <small className="block text-xs font-normal leading-tight text-ink-3">{r.detail}</small> : null}
          </span>
        ) : null,
    },
    { id: "level", header: "Level", render: (r) => r.level ?? "—" },
    { id: "ratio", header: "Ratio", align: "right", render: (r) => ratio(r.ratio) },
    { id: "enc", header: "Compress", align: "right", render: (r) => (r.enc ? mbps(r.enc[1]) : "—") },
    { id: "encr", header: "MB/s min–max", quiet: true, render: (r) => (r.enc ? `${mbps(r.enc[0])}–${mbps(r.enc[2])}` : "no encoder") },
    { id: "dec", header: "Decompress", align: "right", render: (r) => mbps(r.dec[1]) },
    { id: "decr", header: "MB/s min–max", quiet: true, render: (r) => `${mbps(r.dec[0])}–${mbps(r.dec[2])}` },
    {
      id: "code",
      header: "Code, kB gzip'd",
      align: "right",
      render: (r, { first }) =>
        !first ? null : r.code?.builtIn ? (
          "built in"
        ) : r.code?.both !== undefined ? (
          <>
            {kb(r.code.both)} <span className="text-xs text-ink-3">both</span>
          </>
        ) : (
          <>
            <span className="text-xs text-ink-3">dec</span> {kb(r.code?.dec ?? NaN)}
            {r.code?.enc !== undefined ? (
              <>
                {" "}
                <span className="text-xs text-ink-3">enc</span> {kb(r.code.enc)}
              </>
            ) : null}
          </>
        ),
    },
  ];

  return (
    <HighlightScope>
      <ReleaseHeader measure
        title="Component kit: the release template with fixture data"
        meta={[
          { label: "Reference machine", value: "Chrome 156 · macOS · Apple M4 Pro" },
          { label: "Samples", value: "10 per configuration" },
          { label: "Browser", value: "Chrome 156" },
        ]}
        switches={
          <>
            <Switch<Input> label="Input" value={input} onChange={setInput} options={inputs.map((i) => ({ ...i }))} />
            <DatasetSwitch value={dataset} onChange={setDataset} hasMine={hasMine} />
            <BrowserSwitch<"chrome" | "firefox">
              value={browser}
              onChange={setBrowser}
              options={[
                { value: "chrome", label: "Chrome 156" },
                { value: "firefox", label: "Firefox 146" },
              ]}
            />
          </>
        }
        notice={
          <ReleaseNotice>
            Fixture data shaped like real results, for reviewing layout; none of it is a measurement.{" "}
            <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 font-semibold text-ink">
              <input type="checkbox" checked={hasMine} onChange={(e) => setHasMine(e.target.checked)} className="size-4" />
              Pretend a run finished
            </label>
          </ReleaseNotice>
        }
      />
      <ReleaseBody
        sections={sections}
      >
        <Section id="points">
          <MainPoints
            tone={tone}
            points={[
              { text: "The bump allocators took about a third of dlmalloc's time per call.", figure: 1 },
              { text: "wasm64 took 18% longer than wasm32 and used 31% more memory.", figure: 2 },
              { text: "SIMD made zlib-rs deflate 12% faster in Chrome.", figure: [3, 4] },
            ]}
          />
          <p className="mt-6 text-cap text-ink-3">Empty state:</p>
          <MainPoints points={[]} empty="No difference cleared the ±3% threshold on this input, so there are no main points." className="mt-1" />
        </Section>

        <Section id="dots">
          <Figure
            n={1}
            title="The bump allocators took about a third of dlmalloc's time per call"
            subtitle="Time per call, median and observed min–max of 10 samples (µs, log scale)"
          >
            <DotRange
              rows={allocators.map((a) => ({ id: a.id, label: a.label, detail: a.detail, value: a.us[1], range: [a.us[0], a.us[2]] as const, highlight: a.id.startsWith("bump") }))}
              axis={{ kind: "log", title: "Time per call, µs (log scale)", format: (v) => `${v}` }}
              renderValue={(r) => us(r.value)}
              label="Time per call per allocator"
            />
          </Figure>
          <Figure
            n={2}
            title="wasm64 took 18% longer than wasm32 and used 31% more memory"
            subtitle="wasm64 ÷ wasm32, paired by round: median and 95% CI. The line at 1 is no difference."
          >
            <DotRange
              rows={[
                { id: "time", label: "Time per frame", value: 1.18, range: [1.15, 1.22] as const, faint: [1.12, 1.25] as const, highlight: true },
                { id: "mem", label: "Peak memory", value: 1.31, highlight: true },
              ]}
              axis={{ kind: "log", title: "wasm64 ÷ wasm32 (log scale)", format: (v) => `${v}`, reference: 1 }}
              renderValue={(r) => ratio(r.value)}
              rangeName="95% CI"
              label="wasm64 against wasm32"
            />
          </Figure>
          <Figure
            n={3}
            title="This machine ran 18% slower than the reference overall; zstd 3 moved most"
            subtitle="This machine ÷ reference per configuration, divided by the overall geometric mean, so 1 is “moved with the rest”. Marked points moved beyond ±3%."
            source={`Compared with ${sourceLine(edition, "configuration")}`}
          >
            <DotRange
              rows={thisVsRef.map((r) => ({ id: r.id, label: r.label, value: r.value, range: r.range, highlight: r.moved }))}
              axis={{ kind: "log", title: "Relative standing (log scale)", format: (v) => v.toFixed(2), reference: 1, ends: ["fell behind", "pulled ahead"] }}
              renderValue={(r) => ratio(r.value)}
              tone="mine"
              label="This machine against the reference, per configuration"
            />
          </Figure>
        </Section>

        <Section id="effects">
          <Figure
            n={4}
            title="SIMD made zlib-rs deflate 12% faster in Chrome; most other effects were not claimed"
            subtitle="simd128 ÷ scalar, both with wasm-opt -Os, paired by round: median, 95% CI and observed min–max of 15 rounds"
            notes="The A/A control runs the baseline against itself; its spread is the method's noise on this machine."
            legend={
              <Legend
                items={[
                  { mark: { kind: "dot", tone: "accent" }, label: "Claimed: beyond ±3%, CI excludes no change" },
                  { mark: { kind: "dot", tone: "grey" }, label: "Not claimed" },
                  { mark: { kind: "whisker", tone: "grey" }, label: "95% CI of the median" },
                  { mark: { kind: "faint" }, label: "Observed min–max" },
                  { mark: { kind: "band" }, label: "±3% threshold (not claimed)" },
                ]}
              />
            }
          >
            <EffectPlot
              rows={effects.map((e) => ({
                ...e,
                note: e.id === "lz4-dec" ? "No wasm-opt −14%, -Os −8%, -O3 +2% (one capture; not yet a finding)" : undefined,
                noteFacet: e.id === "lz4-dec" ? "firefox" : undefined,
              }))}
              facets={[
                { id: "chrome", title: "Chrome 156" },
                { id: "firefox", title: "Firefox 146" },
              ]}
              label="Effect of SIMD on time, per workload, Chrome and Firefox"
            />
          </Figure>
        </Section>

        <Section id="table">
          <DataTable
            id="kit-table"
            caption="Median MB/s of uncompressed data, with the observed min–max of 10 samples beside it."
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            group={(r) => r.codec}
            failed={(r) => failedRow && r.id === "zune"}
            tone={tone}
            footnote={
              <>
                All 21 configurations round-tripped. Export: <a href="#controls">JSON</a>, <a href="#controls">CSV</a>.{" "}
                <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={failedRow} onChange={(e) => setFailedRow(e.target.checked)} className="size-4" />
                  Show a failed round trip
                </label>
              </>
            }
          />
        </Section>

        <MeasurementNotes
            edition={edition}
            items={[
              { term: "Codecs", detail: "Each codec's own API, one-shot, default window, no checksum. MB/s counts uncompressed bytes, 1 MB = 10⁶ bytes." },
            ]}
            rawHref="#notes"
            rawBytes={482_113}
          />

        <Section id="controls">
          <Prose>
            <p>Buttons, chips, export and the raw-data link, in their states.</p>
          </Prose>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button>Run 21 configurations</Button>
            <Button disabled>Run 21 configurations</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="secondary" disabled>
              Cancel
            </Button>
            <Button variant="quiet">Select all</Button>
          </div>
          <div className="mt-4">
            <ExportButtons baseName="kit" csv={() => "a,b\n1,2\n"} json={() => "{}"} markdown={() => "| a |"} />
          </div>
          <div className="mt-4">
            <RawDataLink href="#controls" bytes={482_113} />
          </div>
        </Section>

        <MeasureSection
          running={state === "running"}
          run={{
            label: "Run 21 configurations",
            onRun: () => setState("running"),
            disabledReason: state === "idle" ? undefined : undefined,
          }}
          onCancel={() => setState("cancelled")}
          progress={{ fraction: 0.42, label: "Sample round 3 of 5", detail: "zstd 9" }}
          outcome={state === "idle" || state === "running" ? undefined : outcomes[state]}
          exports={state === "done" || state === "partial" ? <span>Export: JSON, CSV</span> : <span className="text-ink-3">Export after a run: JSON, CSV</span>}
          input={
            <div className="space-y-3">
              <ChoiceChips label="Reference file" value={input} onChange={setInput} options={inputs.map((i) => ({ ...i }))} />
              <p className="text-sm text-ink-2">Or drop your own file anywhere on this section; it stays in this browser.</p>
            </div>
          }
          configurations={<p className="text-sm text-ink-2">21 configurations (the page supplies the checkbox grid).</p>}
          samples={
            <div className="flex items-center gap-2.5 text-sm text-ink-2">
              <NumberInput
                id="kit-samples"
                min={3}
                max={20}
                value={samples}
                onValueChange={setSamples}
                className={numberFieldClass}
              />
              <label htmlFor="kit-samples">per configuration. The reference used 10.</label>
            </div>
          }
        >
          <MeasureRow label="Kit state">
            <ChoiceChips<KitState> label="Kit state" value={state} onChange={setState} options={states.map((s) => ({ value: s, label: s }))} />
          </MeasureRow>
        </MeasureSection>
      </ReleaseBody>
    </HighlightScope>
  );
}
