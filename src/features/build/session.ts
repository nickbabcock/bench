import { create } from "zustand";
import { runContext } from "@/lib/context";
import { claimRun, releaseRun, useRunRegistry } from "@/lib/runRegistry";
import { type ResultRow, runSubject } from "./harness";
import { type CorpusId, loadCorpus } from "@/features/compression/corpora";
import { BUILD_CORPORA } from "./input";
import { ALLOC_CORPUS, type SubjectKey, usesInput } from "./subjects";

export type Step = { subject: SubjectKey; corpus: CorpusId | null };

/** Every subject on every corpus; input-free subjects (alloc) once. */
export const planFor = (subjects: readonly SubjectKey[], corpora: readonly CorpusId[] = BUILD_CORPORA): Step[] =>
  corpora.flatMap((corpus, i) =>
    subjects.filter((s) => usesInput(s) || i === 0).map((subject) => ({ subject, corpus: usesInput(subject) ? corpus : null })),
  );

export type Progress = {
  subject: SubjectKey;
  phase: string;
  completed: number;
  total: number;
  /** Untimed preparation done, 0..1: load, calibrate, warm up. */
  prep: number;
  /** This step's index in the plan, from 0, and the plan's length. */
  step: number;
  steps: number;
};

/** The headline workloads: zlib-rs deflate, where SIMD depends most on the CPU. */
const DEFAULT_SUBJECTS: SubjectKey[] = ["zlib-rs-deflate-1", "zlib-rs-deflate"];

type Session = {
  sampleCount: number;
  /** What the visitor chose to run. */
  subjects: SubjectKey[];
  corpora: CorpusId[];
  /** Rows of every run, newest first; `run` groups them. */
  results: ResultRow[];
  /** The run shown as This machine. */
  selected: number | null;
  /**
   * Which dataset the page shows. Kept here, not in the page, so a run
   * that finishes while the visitor is on another page still opens in
   * This machine on return.
   */
  dataset: "reference" | "mine";
  /** The latest run started (its rows may be none, if it was cancelled or failed at once). */
  lastRun: number | null;
  /** Read out at the #results target when a run ends. */
  announcement: string;
  /** Steps the latest run planned. */
  planned: number;
  progress?: Progress;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  cancelled: boolean;
  cancelling: boolean;
};

/** Build-settings state survives tab switches; a run keeps going meanwhile. */
export const useBuildSession = create<Session>()(() => ({
  sampleCount: 15,
  subjects: DEFAULT_SUBJECTS,
  corpora: [...BUILD_CORPORA],
  results: [],
  selected: null,
  dataset: "reference",
  lastRun: null,
  announcement: "",
  planned: 0,
  cancelled: false,
  cancelling: false,
}));

const set = useBuildSession.setState;
const get = useBuildSession.getState;
let controller: AbortController | null = null;
let nextId = 1;
let nextRun = 1;

export const selectRun = (selected: number) => set({ selected, dataset: "mine" });
export const setDataset = (dataset: "reference" | "mine") => set({ dataset });
export const setSampleCount = (sampleCount: number) => set({ sampleCount });
export const setSubjects = (subjects: SubjectKey[]) => set({ subjects });
export const setCorpora = (corpora: CorpusId[]) => set({ corpora });

export function cancelRun() {
  set({ cancelling: true });
  controller?.abort();
}

/** Run each step in turn (all seven variants each); every finished step joins the results. */
export async function startRun(plan: readonly Step[]) {
  const { sampleCount } = get();
  if (useRunRegistry.getState().active !== null || plan.length === 0 || !Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 100) {
    return;
  }
  const context = runContext();
  claimRun("build");
  controller = new AbortController();
  const { signal } = controller;
  const run = nextRun++;
  set({
    error: undefined,
    cancelled: false,
    cancelling: false,
    startedAt: Date.now(),
    endedAt: undefined,
    planned: plan.length,
    selected: run,
    lastRun: run,
    announcement: "Build settings benchmark started.",
  });
  try {
    for (const [step, { subject, corpus }] of plan.entries()) {
      // The allocation workload loads its own input (xml) in the worker.
      const input = corpus ? await loadCorpus(corpus, signal) : { name: ALLOC_CORPUS, bytes: new Uint8Array(0) };
      const progress = { subject, step, steps: plan.length, total: sampleCount };
      set({ progress: { ...progress, phase: "Starting the worker", completed: 0, prep: 0 } });
      const startedAt = Date.now();
      const row = await runSubject(subject, input, sampleCount, signal, (completed, phase, prep) => set({ progress: { ...progress, phase, completed, prep } }));
      const id = nextId++;
      // A run's first row switches the page to This machine, whether or not it is open; later rows keep the visitor's choice.
      set((s) => ({ results: [{ ...row, id, run, context, startedAt, endedAt: Date.now() }, ...s.results], ...(step === 0 ? { dataset: "mine" as const } : {}) }));
    }
    set({ announcement: `Measured ${plan.length === 1 ? "1 row" : `${plan.length} rows`}. The page now shows This machine.` });
  } catch (e) {
    const done = get().results.filter((r) => r.run === run).length;
    if (signal.aborted) {
      set({ cancelled: true, announcement: `Cancelled after ${done} of ${plan.length} rows.` });
    } else {
      set({ error: e instanceof Error ? e.message : String(e), announcement: "The run failed. See the message under Run." });
    }
  } finally {
    set({ progress: undefined, cancelling: false, endedAt: Date.now() });
    controller = null;
    releaseRun("build");
  }
}
