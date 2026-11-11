import { create } from "zustand";
import { runContext } from "@/lib/context";
import { claimRun, releaseRun, useRunRegistry } from "@/lib/runRegistry";
import { MIN_PAIRED_ROUNDS } from "@/lib/stats";
import { runClaim } from "./claims";
import { type Progress, type ResultRow, runWorkload } from "./harness";
import { defaultParams, type WorkloadKey, workloadKeys, type WorkloadParams, workloads } from "./workloads";

type Session = {
  params: Record<WorkloadKey, WorkloadParams>;
  sampleCount: number;
  /** Finished runs, newest first. */
  results: ResultRow[];
  selected: number | null;
  /**
   * The newest run the page has opened. A run that finishes while the
   * visitor is elsewhere is newer than this, so the page opens on This
   * machine when they return.
   */
  viewed: number | null;
  progress?: Progress;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  cancelled: boolean;
  cancelling: boolean;
  announcement: string;
};

/** Rounds per run: a paired 95% CI needs at least MIN_PAIRED_ROUNDS, so that is also the minimum. */
const DEFAULT_ROUNDS = 10;
export const MIN_ROUNDS = MIN_PAIRED_ROUNDS;
export const MAX_ROUNDS = 100;

/** Memory64 state survives tab switches; a run keeps going meanwhile. */
export const useMemory64Session = create<Session>()(() => ({
  params: Object.fromEntries(workloadKeys.map((key) => [key, defaultParams(key)])) as Record<WorkloadKey, WorkloadParams>,
  sampleCount: DEFAULT_ROUNDS,
  results: [],
  selected: null,
  viewed: null,
  cancelled: false,
  cancelling: false,
  announcement: "",
}));

const set = useMemory64Session.setState;
const get = useMemory64Session.getState;
let controller: AbortController | null = null;
let nextId = 1;

export const selectRun = (selected: number) => set({ selected });
/** The page has shown run `id` as This machine. */
export const markViewed = (viewed: number) => set({ viewed });
export const setSampleCount = (sampleCount: number) => set({ sampleCount });
export const setParam = (key: WorkloadKey, param: string, value: number) =>
  set((s) => ({ params: { ...s.params, [key]: { ...s.params[key], [param]: value } } }));

export function cancelRun() {
  set({ cancelling: true });
  controller?.abort();
}

/** One run of the workload with the session's parameters; it joins the runs, newest first. */
export async function startRun(workload: WorkloadKey) {
  if (useRunRegistry.getState().active !== null) {
    return;
  }
  const { params, sampleCount } = get();
  // The page validates before enabling Run; refuse anything it missed.
  const p = { ...params[workload] };
  const whole = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!whole(sampleCount, MIN_ROUNDS, MAX_ROUNDS) || workloads[workload].params.some((wp) => !whole(p[wp.key], wp.min, wp.max))) {
    return;
  }
  const context = runContext();
  claimRun("memory64");
  controller = new AbortController();
  const { signal } = controller;
  const startedAt = Date.now();
  set({
    error: undefined,
    cancelled: false,
    cancelling: false,
    startedAt,
    endedAt: undefined,
    progress: { workload, phase: "Starting the worker", completed: 0, total: sampleCount, prep: 0 },
    announcement: "Memory64 benchmark started.",
  });
  try {
    const row = await runWorkload(workload, p, sampleCount, signal, (completed, phase, prep) =>
      set({ progress: { workload, phase, completed, total: sampleCount, prep } }),
    );
    const id = nextId++;
    set((s) => ({ results: [{ ...row, id, context, startedAt, endedAt: Date.now() }, ...s.results], selected: id }));
    set({ announcement: `Memory64 benchmark finished. ${runClaim(get().results[0])}` });
  } catch (e) {
    if (signal.aborted) {
      set({ cancelled: true, announcement: "Memory64 benchmark cancelled." });
    } else {
      const error = e instanceof Error ? e.message : String(e);
      set({ error, announcement: `Memory64 benchmark stopped with an error: ${error}` });
    }
  } finally {
    set({ progress: undefined, cancelling: false, endedAt: Date.now() });
    controller = null;
    releaseRun("memory64");
  }
}
