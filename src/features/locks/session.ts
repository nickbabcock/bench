import { create } from "zustand";
import { runContext } from "@/lib/context";
import { claimRun, releaseRun, useRunRegistry } from "@/lib/runRegistry";
import { MIN_PAIRED_ROUNDS } from "@/lib/stats";
import { runClaim } from "./claims";
import { type Progress, type ResultRow, runLocks } from "./harness";

type Session = {
  sampleCount: number;
  /** Finished runs, newest first. */
  results: ResultRow[];
  selected: number | null;
  /** The newest run the page has opened (see Memory64's session). */
  viewed: number | null;
  progress?: Progress;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  cancelled: boolean;
  cancelling: boolean;
  announcement: string;
};

/** Rounds per run: a paired 95% CI needs at least MIN_PAIRED_ROUNDS. */
const DEFAULT_ROUNDS = 10;
export const MIN_ROUNDS = MIN_PAIRED_ROUNDS;
export const MAX_ROUNDS = 100;

/** RefCell against Mutex state survives tab switches; a run continues meanwhile. */
export const useLocksSession = create<Session>()(() => ({
  sampleCount: DEFAULT_ROUNDS,
  results: [],
  selected: null,
  viewed: null,
  cancelled: false,
  cancelling: false,
  announcement: "",
}));

const set = useLocksSession.setState;
const get = useLocksSession.getState;
let controller: AbortController | null = null;
let nextId = 1;

export const selectRun = (selected: number) => set({ selected });
export const markViewed = (viewed: number) => set({ viewed });
export const setSampleCount = (sampleCount: number) => set({ sampleCount });

export function cancelRun() {
  set({ cancelling: true });
  controller?.abort();
}

/** One run of every workload in every build; it joins the runs, newest first. */
export async function startRun() {
  if (useRunRegistry.getState().active !== null) {
    return;
  }
  const { sampleCount } = get();
  if (!Number.isInteger(sampleCount) || sampleCount < MIN_ROUNDS || sampleCount > MAX_ROUNDS) {
    return;
  }
  const context = runContext();
  claimRun("locks");
  controller = new AbortController();
  const { signal } = controller;
  const startedAt = Date.now();
  set({
    error: undefined,
    cancelled: false,
    cancelling: false,
    startedAt,
    endedAt: undefined,
    progress: { phase: "Starting the worker", completed: 0, total: sampleCount, prep: 0 },
    announcement: "RefCell against Mutex benchmark started.",
  });
  try {
    const row = await runLocks(sampleCount, signal, (completed, phase, prep) => set({ progress: { phase, completed, total: sampleCount, prep } }));
    const id = nextId++;
    set((s) => ({ results: [{ ...row, id, context, startedAt, endedAt: Date.now() }, ...s.results], selected: id }));
    set({ announcement: `RefCell against Mutex benchmark finished. ${runClaim(get().results[0])}` });
  } catch (e) {
    if (signal.aborted) {
      set({ cancelled: true, announcement: "RefCell against Mutex benchmark cancelled." });
    } else {
      const error = e instanceof Error ? e.message : String(e);
      set({ error, announcement: `RefCell against Mutex benchmark stopped with an error: ${error}` });
    }
  } finally {
    set({ progress: undefined, cancelling: false, endedAt: Date.now() });
    controller = null;
    releaseRun("locks");
  }
}
