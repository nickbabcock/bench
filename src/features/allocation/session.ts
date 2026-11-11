import { create } from "zustand";
import { loadCorpus } from "@/features/compression/corpora";
import { runContext } from "@/lib/context";
import { claimRun, releaseRun, useRunRegistry } from "@/lib/runRegistry";
import { MIN_PAIRED_ROUNDS } from "@/lib/stats";
import { type AllocationRun, INPUT, type Progress, runAllocation } from "./harness";

type Session = {
  samples: number;
  /** Finished runs, newest first. */
  runs: AllocationRun[];
  selected: number | null;
  /**
   * The newest run the page has opened. A run that finishes while the
   * visitor is elsewhere is newer than this, so the page opens on This
   * machine when they return.
   */
  viewed: number | null;
  progress: Progress | null;
  running: boolean;
  cancelling: boolean;
  error?: string;
  cancelled: boolean;
  announcement: string;
};

/** Rounds per allocator: a paired 95% CI needs at least MIN_PAIRED_ROUNDS, so that is also the minimum. */
export const DEFAULT_SAMPLES = 10;
export const MIN_SAMPLES = MIN_PAIRED_ROUNDS;
export const MAX_SAMPLES = 100;

/** Allocation state survives tab switches; a run keeps going meanwhile. */
export const useAllocationSession = create<Session>()(() => ({
  samples: DEFAULT_SAMPLES,
  runs: [],
  selected: null,
  viewed: null,
  progress: null,
  running: false,
  cancelling: false,
  cancelled: false,
  announcement: "",
}));

const set = useAllocationSession.setState;
const get = useAllocationSession.getState;
let controller: AbortController | null = null;
let nextId = 1;

export const setSamples = (samples: number) => set({ samples });
export const selectRun = (selected: number) => set({ selected });
/** The page has shown run `id` as This machine. */
export const markViewed = (viewed: number) => set({ viewed });

export function cancelRun() {
  set({ cancelling: true });
  controller?.abort();
}

/** One run of all four allocators over the xml documents; it joins the runs, newest first. */
export async function startRun() {
  const { samples } = get();
  // The page validates before enabling Run; refuse anything it missed.
  if (!Number.isInteger(samples) || samples < MIN_SAMPLES || samples > MAX_SAMPLES) {
    return;
  }
  if (useRunRegistry.getState().active !== null) {
    return;
  }
  const context = runContext();
  claimRun("allocation");
  controller = new AbortController();
  const { signal } = controller;
  set({ running: true, cancelling: false, cancelled: false, error: undefined, progress: null, announcement: "Allocation benchmark started." });
  try {
    set({ progress: { phase: "Loading the xml documents", detail: "", done: 0, total: 1 } });
    const { bytes } = await loadCorpus(INPUT, signal);
    const startedAt = Date.now();
    const result = await runAllocation(bytes, samples, signal, (progress) => set({ progress }));
    const id = nextId++;
    set((s) => ({ runs: [{ ...result, id, startedAt, endedAt: Date.now(), context }, ...s.runs], selected: id }));
    set({
      announcement: result.checksumsMatch
        ? `Allocation benchmark finished: four allocators, ${samples} samples each. The page now shows this machine.`
        : "Allocation benchmark finished, but the modules computed different checksums, so the run is not a valid comparison.",
    });
  } catch (e) {
    if (signal.aborted) {
      set({ cancelled: true, announcement: "Allocation benchmark cancelled." });
    } else {
      const error = e instanceof Error ? e.message : String(e);
      set({ error, announcement: `Allocation benchmark stopped with an error: ${error}` });
    }
  } finally {
    set({ running: false, cancelling: false, progress: null });
    controller = null;
    releaseRun("allocation");
  }
}
