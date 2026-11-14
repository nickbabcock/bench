import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef } from "react";
import type { Edition } from "@/lib/edition";
import { ChevronDownIcon } from "@/components/icons";
import { formatBytes, formatInteger } from "@/lib/format";
import { RawDataLink } from "./RawDataLink";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const localDateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });

/**
 * "8 November 2026". A reference edition's date is in UTC, so prerendered
 * HTML and the browser agree. Pass `"local"` for a run measured in this
 * browser (or use `runDate`), which shows the visitor's own calendar date.
 */
export const editionDate = (t: string | number, zone: "UTC" | "local" = "UTC") => (zone === "UTC" ? dateFmt : localDateFmt).format(new Date(t));

/** The local date of a run in this browser, from its start time (ms or ISO): "8 November 2026". */
export const runDate = (t: string | number) => editionDate(t, "local");

/** Browser and major version: "Chrome 156". */
const browserShort = (e: Pick<Edition, "browser">) => `${e.browser.name} ${e.browser.version.split(".")[0]}`;

/**
 * An edition in one line, for a figure whose data is not the page's own
 * (a this-machine figure compared with a reference edition):
 * "WASM Bench reference edition 2026-11-08: Chrome 156 on macOS 26.1,
 * Apple M4 Pro (arm64), 10 samples per row". A figure of the page's own
 * edition has no Source line: the Measurement notes line says it once.
 */
export const sourceLine = (e: Pick<Edition, "id" | "browser" | "machine" | "method">, per = "row") =>
  `WASM Bench reference edition ${e.id}: ${browserShort(e)} on ${e.machine.os}, ${e.machine.cpuModel} (${e.machine.arch}), ${e.method.samples} samples per ${per}`;

/**
 * The Measurement notes line for an edition, the page's one statement of
 * where its figures come from: "Reference edition 2026-11-08", "Apple M4
 * Pro (arm64), macOS 26.5.2 (25F84)", "Chrome 156", "10 samples per row".
 * `browsers` names every engine shown when there are several ("Chrome 156
 * and Firefox 151"); `samples` replaces the samples item ("15 rounds per
 * row, 2 captures each").
 */
export const editionProvenance = (
  e: Pick<Edition, "id" | "browser" | "machine" | "method">,
  { per = "row", browsers, samples }: { per?: string; browsers?: string; samples?: string } = {},
): string[] => [
  `Reference edition ${e.id}`,
  `${e.machine.cpuModel} (${e.machine.arch}), ${e.machine.os}`,
  browsers ?? browserShort(e),
  samples ?? `${e.method.samples} samples per ${per}`,
];

const ms = (x: number) => (x < 1 ? `${formatInteger(Math.round(x * 1000))} µs` : `${+x.toFixed(2)} ms`);

export type NoteItem = { term: React.ReactNode; detail: React.ReactNode };

export type MeasurementNotesProps = {
  /** The edition shown (repeat 1). Omit for a this-machine run with no edition. */
  edition?: Edition;
  /**
   * The visible provenance line, before the Method and raw-data links: the
   * page's one statement of its source, so figures of the page's own data
   * carry no Source line. Default, from the edition (`editionProvenance`):
   * edition · machine and OS build · browser · samples. For a this-machine
   * run pass its own: ["8 November 2026", "Chrome 156", "macOS", "5
   * samples per row"].
   */
  provenance?: React.ReactNode[];
  /** Samples noun in the default provenance ("10 samples per row"). */
  per?: string;
  /** Section id (default "notes"). */
  id?: string;
  /** Benchmark-specific rows (codec parameters, the MB/s definition), placed after Method. */
  items?: NoteItem[];
  /** Same-origin URL of the edition's raw JSON. */
  rawHref?: string;
  rawBytes?: number;
  /**
   * The crates this page measures, as keys of the edition's
   * `toolchain.crates` ("zstd", "bump-scope"), in the order to list them.
   * Omit to list every crate the build pinned.
   */
  libraries?: readonly string[];
  /**
   * The Build row's text, for a page whose modules use another toolchain
   * than the site's (a nightly with std from source, no wasm-opt). Default:
   * the edition's site toolchain and release profile.
   */
  build?: React.ReactNode;
};

const Mono = ({ children }: { children: React.ReactNode }) => <code className="break-all">{children}</code>;

const MethodLink = () => (
  <Link to="/method" className="link">
    Method
  </Link>
);

/**
 * The "Measurement notes" block, on its own (not inside a <Section>): a
 * one-line provenance summary that is always visible (date · machine ·
 * browser · samples · Method · raw data), then a single closed
 * <details> "Measurement notes" holding everything needed to judge and
 * reproduce an edition: conditions, clock and isolation, method, build
 * toolchain and versions, commit, a SHA-256 per wasm artifact and corpus
 * file.
 *
 * Items are page-specific rows, and figure-note boilerplate (pairing,
 * threshold, timer) belongs here or on Method. Don't repeat the release
 * header's notice (the engine or machine note) here.
 */
export const MeasurementNotes = ({ edition: e, items = [], rawHref, rawBytes, libraries, provenance, per = "row", id = "notes", build }: MeasurementNotesProps) => {
  const rows: NoteItem[] = [];
  if (e) {
    const power =
      e.machine.power.source === "AC" ? "on AC power" : e.machine.power.source === "battery" ? "on battery" : "power source unknown";
    const lpm = e.machine.power.lowPowerMode === null ? "" : e.machine.power.lowPowerMode ? ", Low Power Mode on" : ", Low Power Mode off";
    rows.push({
      term: "Conditions",
      detail: (
        <>
          {e.browser.name} {e.browser.version}
          {e.browser.headless ? " (headless)" : ""} on {e.machine.os}; {e.machine.cpuModel}, {e.machine.arch}
          {e.machine.cores ? `, ${e.machine.cores} logical cores` : ""}; {power}
          {lpm}. Captured {editionDate(e.capturedAt)}, {timeFmt.format(new Date(e.capturedAt))}–{timeFmt.format(new Date(e.endedAt))} UTC. Capture{" "}
          {e.repeat.index} of {e.repeat.of}.
        </>
      ),
    });
    rows.push({
      term: "Clock",
      detail: (
        <>
          {e.browser.crossOriginIsolated ? "Cross-origin isolated" : "Not cross-origin isolated"}. Timer resolution in a worker{" "}
          {ms(e.browser.timerResolutionMs)} (median step; finest {ms(e.browser.timerMinStepMs)}).
        </>
      ),
    });
    rows.push({
      term: "Method",
      detail: (
        <>
          {e.method.samples} samples per row, each a batch of at least {e.method.batchTargetMs} ms divided by its repetitions. Untimed
          warm-up of at least {e.method.warmup.minMs} ms and {e.method.warmup.minRounds} rounds (at most {e.method.warmup.maxRounds}).
          Order {e.method.order === "rotate" ? "rotated by one each round" : "alternated each round"}
          {e.method.paired ? "; ratios are paired by round" : ""}.
        </>
      ),
    });
  }
  rows.push(...items);
  if (e) {
    const t = e.toolchain;
    rows.push({
      term: "Build",
      detail: build ?? (
        <>
          {t.rustc}; {t.wasiSdk}; {t.binaryen}; wasm-bindgen {t.wasmBindgen}. Release profile: opt-level {t.profile.optLevel}, LTO{" "}
          {t.profile.lto}, codegen-units {t.profile.codegenUnits}
          {t.profile.targetFeatures.length ? `, target features ${t.profile.targetFeatures.join(", ")}` : ", no extra target features"}, wasm-opt{" "}
          {t.profile.wasmOpt}.
        </>
      ),
    });
    const crates = libraries ? libraries.flatMap((k) => (t.crates[k] === undefined ? [] : [[k, t.crates[k]] as const])) : Object.entries(t.crates);
    if (crates.length) {
      rows.push({
        term: "Libraries",
        detail: crates.map(([k, v], i) => (
          <Fragment key={k}>
            <span className="whitespace-nowrap">
              {k} {v}
              {i < crates.length - 1 ? "," : "."}
            </span>{" "}
          </Fragment>
        )),
      });
    }
    rows.push({
      term: "Commit",
      detail: (
        <>
          <Mono>{e.commit.sha.slice(0, 12)}</Mono>
          {e.commit.dirty ? " (with uncommitted changes)" : ""}
        </>
      ),
    });
    rows.push({
      term: "Artifacts",
      detail: (
        <details>
          <summary className="cursor-pointer">
            {e.artifacts.length} wasm {e.artifacts.length === 1 ? "module" : "modules"}, SHA-256
          </summary>
          <ul className="mt-1 space-y-0.5 text-cap">
            {e.artifacts.map((a) => (
              <li key={a.name}>
                <Mono>{a.name}</Mono> {formatBytes(a.bytes)} <Mono>{a.sha256}</Mono>
              </li>
            ))}
          </ul>
        </details>
      ),
    });
    if (e.corpus.length) {
      rows.push({
        term: "Corpus",
        detail: (
          <>
            Silesia corpus subset ({e.corpus.length} of 12 files), checked against pinned SHA-256 hashes when packed and by length
            when loaded.
            <ul className="mt-1 space-y-0.5 text-cap">
              {e.corpus.map((f) => (
                <li key={f.id}>
                  {f.id} {formatInteger(f.bytes)} bytes <Mono>{f.sha256}</Mono>
                </li>
              ))}
            </ul>
          </>
        ),
      });
    }
  }
  if (rawHref) {
    rows.push({ term: "Raw data", detail: <RawDataLink href={rawHref} bytes={rawBytes} /> });
  }
  const details = useRef<HTMLDetailsElement>(null);
  // A link to #notes (a figure's note, say) opens the disclosure: on load, on hashchange, and on a click when the hash is already #notes.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === `#${id}` && details.current) {
        details.current.open = true;
      }
    };
    const onClick = (ev: MouseEvent) => {
      const a = (ev.target as Element | null)?.closest?.("a[href]");
      if (a && a.getAttribute("href") === `#${id}` && details.current) {
        details.current.open = true;
      }
    };
    open();
    window.addEventListener("hashchange", open);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", open);
      document.removeEventListener("click", onClick);
    };
  }, [id]);
  const line: React.ReactNode[] = [
    ...(provenance ?? (e ? editionProvenance(e, { per }) : [])),
    <MethodLink key="method" />,
    ...(rawHref ? [<RawDataLink key="raw" href={rawHref} label="Raw data (JSON)" bytes={rawBytes} />] : []),
  ];
  return (
    <section id={id} aria-label="Measurement notes" className="mt-14 scroll-mt-4 border-t border-rule pt-3">
      <details ref={details} className="group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <ChevronDownIcon className="size-4 -rotate-90 text-ink-3 transition-transform duration-150 group-open:rotate-0" />
          Measurement notes
        </summary>
        <dl className="mt-3 mb-4 grid max-w-[780px] grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-0.5 text-sm sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-y-2.5">
          {rows.map((r, i) => (
            <div key={i} className="contents">
              <dt className="font-semibold text-ink max-sm:mt-2">{r.term}</dt>
              <dd className="prose-links text-ink-2 [&_code]:text-ink">{r.detail}</dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="prose-links mt-1 text-cap text-ink-2">
        {line.map((x, i) => (
          <Fragment key={i}>
            {/* The space lets the line wrap between items on a phone. The dot starts its item, so a full line does not end in a dot past the edge. */}
            {i > 0 ? " " : null}
            <span className="whitespace-nowrap">
              {i > 0 ? <span className="pr-1.5 text-ink-3">·</span> : null}
              {x}
            </span>
          </Fragment>
        ))}
      </p>
    </section>
  );
};
