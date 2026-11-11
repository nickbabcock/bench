import { create } from "zustand";
import { claimRun, releaseRun, useRunRegistry } from "@/lib/runRegistry";
import { plannedConfigs, supportsCompressionStreams } from "./codecs";
import { corpusInfo, type CorpusId, inputName, loadCorpus } from "./corpora";
import { runCompression } from "./harness";
import { resultRows, samplesCollected } from "./results";
import { useCompressionUi } from "./store";
import type { CompressionRun, ConfigResult, Progress } from "./types";
import { plural } from "@/lib/format";
import { runContext } from "@/lib/context";

export type Source = { kind: "file"; file: File } | { kind: "corpus"; id: CorpusId };

type Session = {
  runs: CompressionRun[];
  progress: Progress | null;
  cancelling: boolean;
  samples: number;
  /** The input the next run uses: chosen, not yet run. */
  source: Source;
  /** A problem with the last attempt that isn't a run error (bad drop). */
  notice: string | null;
  /** Why the file just chosen wasn't used (it's empty), shown by the chooser. */
  sourceError: string | null;
  /** Completion summary for the persistent live region. */
  announcement: string;
  /**
   * The newest run the page has shown as This machine. A run that ends
   * while the visitor is on another page is newer than this, so the page
   * opens on it when they come back.
   */
  viewedRun: number | null;
};

/**
 * Compression state lives outside the page component, so runs, inputs and
 * history survive switching tabs, and a run in progress keeps going.
 */
export const useCompressionSession = create<Session>()(() => ({
  runs: [],
  progress: null,
  cancelling: false,
  samples: 5,
  source: { kind: "corpus", id: "dickens" },
  notice: null,
  sourceError: null,
  announcement: "",
  viewedRun: null,
}));

let controller: AbortController | null = null;
let nextId = 1;

const set = useCompressionSession.setState;
const get = useCompressionSession.getState;

const updateCurrent = (fn: (run: CompressionRun) => CompressionRun) =>
  set((s) => {
    const [current, ...rest] = s.runs;
    return current ? { runs: [fn(current), ...rest] } : s;
  });

const updateConfig = (id: string, fn: (c: ConfigResult) => ConfigResult) =>
  updateCurrent((run) => ({
    ...run,
    configs: run.configs.map((c) => (c.spec.id === id ? fn(c) : c)),
  }));

export const setSamples = (samples: number) => set({ samples });
export const EMPTY_FILE = "This file is empty (0 bytes); choose a file with content.";

/**
 * Choose the input; the run starts only from Run. An empty file is refused
 * here, at selection, with the reason, and the previous input stays.
 */
export const setSource = (source: Source) =>
  source.kind === "file" && source.file.size === 0
    ? set({ sourceError: `${source.file.name}: ${EMPTY_FILE}`, notice: null })
    : set({ source, notice: null, sourceError: null });
/** The page is showing this run as This machine. */
export const markViewed = (id: number) => get().viewedRun === id || set({ viewedRun: id });
export const setNotice = (notice: string | null) => set({ notice });

export function cancelRun() {
  set({ cancelling: true });
  controller?.abort();
}

/** The completion line for the live region: what was measured, and how many samples. */
function summary(run: CompressionRun) {
  const rows = resultRows(run);
  const measured = rows.filter((r) => r.decode).length;
  return `${inputName(run)}: ${plural(measured, "configuration")} measured, ${plural(samplesCollected(rows), "sample")} each.`;
}

/**
 * What a cancelled run kept: nothing; some configurations; or every
 * configuration with fewer sample rounds than planned ("2 of 5 sample rounds").
 */
export function cancelSummary(run: CompressionRun): string {
  const rows = resultRows(run);
  const measured = rows.filter((r) => r.decode).length;
  if (measured === 0) {
    return "Benchmark cancelled before anything was measured.";
  }
  const rounds = samplesCollected(rows);
  const all = rows.every((r) => r.decode);
  return all
    ? `Benchmark cancelled after ${rounds} of ${plural(run.samples, "sample round")}; every configuration has at least one, and those are shown.`
    : `Benchmark cancelled after ${measured} of ${plural(rows.length, "configuration")}; those are shown.`;
}

export async function startRun() {
  const { samples, source } = get();
  if (useRunRegistry.getState().active !== null) {
    return;
  }
  const enabled = useCompressionUi.getState().enabled;
  const specs = plannedConfigs(enabled, supportsCompressionStreams());
  if (specs.length === 0) {
    return;
  }
  // A corpus file is fetched once the run starts; its name and size are known.
  const input = source.kind === "file" ? { name: source.file.name, bytes: source.file.size } : corpusInfo(source.id);
  const synthetic = source.kind === "corpus";

  claimRun("compression");
  controller = new AbortController();
  const { signal } = controller;
  const id = nextId++;
  set((s) => ({
    runs: [
      {
        id,
        filename: input.name,
        synthetic,
        bytes: input.bytes,
        samples,
        startedAt: Date.now(),
        status: "running",
        context: runContext(),
        configs: specs.map((spec) => ({ spec, encodeMs: [], decodeMs: [] })),
      },
      ...s.runs,
    ],
    progress: null,
    cancelling: false,
    notice: null,
    announcement: `Benchmark started: ${plural(specs.length, "configuration")} on ${inputName({ filename: input.name, synthetic })}.`,
  }));

  try {
    // Fetching and decompressing a corpus file happens before, and outside,
    // any timing.
    let data: Uint8Array<ArrayBuffer>;
    if (source.kind === "file") {
      data = new Uint8Array(await source.file.arrayBuffer());
    } else {
      set({ progress: { phase: "Loading the input", detail: `${input.name} · Silesia corpus`, done: 0, total: 1 } });
      data = (await loadCorpus(source.id, signal)).bytes;
    }
    await runCompression(data, specs, samples, signal, {
      progress: (progress) => set({ progress }),
      prepared: (configId, info) => updateConfig(configId, (c) => ({ ...c, ...info })),
      sample: (configId, encodeMs, decodeMs) =>
        updateConfig(configId, (c) => ({
          ...c,
          encodeMs: encodeMs === undefined ? c.encodeMs : [...c.encodeMs, encodeMs],
          decodeMs: [...c.decodeMs, decodeMs],
        })),
    });
    updateCurrent((run) => ({ ...run, status: "done", endedAt: Date.now() }));
    set({ announcement: `Benchmark finished. ${summary(get().runs[0])}` });
  } catch (e) {
    if (signal.aborted) {
      updateCurrent((run) => ({ ...run, status: "cancelled", endedAt: Date.now() }));
      set({ announcement: cancelSummary(get().runs[0]) });
    } else {
      const error = e instanceof Error ? e.message : String(e);
      updateCurrent((run) => ({ ...run, status: "error", error, endedAt: Date.now() }));
      set({ announcement: `Benchmark stopped with an error: ${error}` });
    }
  } finally {
    set({ progress: null, cancelling: false });
    controller = null;
    releaseRun("compression");
  }
}
