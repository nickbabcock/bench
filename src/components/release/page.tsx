/**
 * Helpers the benchmark pages share: the visitor's machine as a scope,
 * the This machine switch, feature probes, and the notes and reasons
 * every page words the same way.
 */
import { Link } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { hardware } from "@/lib/build";
import type { RunContext } from "@/lib/context";
import type { Edition } from "@/lib/edition";
import type { MachineRef } from "@/lib/findings";
import { formatDuration, quantity } from "@/lib/format";
import { type Benchmark, benchmarkNames, benchmarkRoutes } from "@/lib/runRegistry";
import { editionDate, type NoteItem, runDate } from "./MeasurementNotes";
import { RawDataLink } from "./RawDataLink";
import type { Dataset } from "./ReleaseHeader";

/** The visitor's machine, as a scope: one machine, named in the Source line. */
export const THIS_MACHINE: MachineRef = { id: "this-machine", cpuModel: "this machine", arch: "unknown" };

/** A duration with its unit: "12.3 ms". */
export const ms = (v: number) => quantity(formatDuration(v));

const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** An edition's month, for the page title: "2026-11-08" → "November 2026". */
export const monthOf = (editionId: string) => monthFmt.format(new Date(`${editionId}T00:00:00Z`));

/** relativeSentence without its parenthetical (the geometric mean and range are the figure's), so the point carries one citation. */
export const overallOnly = (sentence: string) => sentence.replace(/ \([^()]*\)\.$/, "");

/**
 * The newest run opens as This machine once: when it finishes on this
 * page, or later when the visitor comes back to it. The run id the page
 * last opened lives in the session store (`markViewed`), so leaving the
 * page during a run doesn't lose the switch.
 */
export function useDataset(newest: number | undefined, viewed: number | null, markViewed: (id: number) => void) {
  const unseen = newest !== undefined && newest !== viewed;
  const [dataset, setDataset] = useState<Dataset>(unseen ? "mine" : "reference");
  if (unseen && dataset !== "mine") {
    setDataset("mine");
  }
  useEffect(() => {
    if (unseen) {
      markViewed(newest);
    }
  }, [unseen, newest, markViewed]);
  return [dataset, setDataset] as const;
}

const noopSubscribe = () => () => {};
/** `undefined` while prerendering, then `probe()`: a browser feature that doesn't change. */
export const useSupport = (probe: () => boolean) => useSyncExternalStore<boolean | undefined>(noopSubscribe, probe, () => undefined);


/** Why Run is off while another benchmark runs: "Allocation is running. Go to it to finish or cancel it first." */
export const OtherRunning = ({ benchmark }: { benchmark: Benchmark }) => (
  <>
    {benchmarkNames[benchmark]} is running.{" "}
    <Link className="link" to={benchmarkRoutes[benchmark]}>
      Go to it
    </Link>{" "}
    to finish or cancel it first.
  </>
);

/** The Conditions note for a run on this machine: browser, platform and timer, then when and how it was measured (`method`). */
export const conditionsNote = (run: { context?: RunContext; startedAt: number }, method: string): NoteItem => {
  const c = run.context;
  const platform = hardware().platform;
  return {
    term: "Conditions",
    detail: `${c?.browser ?? "This browser"}${platform ? ` on ${platform}` : ""}${c?.cores ? `, ${c.cores} logical cores` : ""}; ${c?.crossOriginIsolated ? "cross-origin isolated" : "not cross-origin isolated"}, smallest timer step ${ms(c?.timerMs ?? NaN)}. Measured ${runDate(run.startedAt)}, ${method}`,
  };
};

/** A Measurement notes item for a browser's capture beyond the first (Conditions describe the first): version, date, which capture, raw data. */
export const captureNote = (s: { engine: string; edition: Edition; rawHref?: string }): NoteItem => ({
  term: `${s.engine} capture`,
  detail: (
    <>
      {s.edition.browser.name} {s.edition.browser.version}
      {s.edition.browser.headless ? " (headless)" : ""}, captured {editionDate(s.edition.capturedAt)},{" "}
      <span className="whitespace-nowrap">
        capture {s.edition.repeat.index} of {s.edition.repeat.of}
      </span>
      .{" "}
      {s.rawHref ? <RawDataLink href={s.rawHref} /> : null}
    </>
  ),
});
