import { releaseProxy, wrap } from "comlink";
import { abortable, calibrate, warmUp } from "@/lib/bench";
import type { Memory64Worker } from "./worker";
import type { RunContext } from "@/lib/context";
import type { Variant, WorkloadKey, WorkloadParams } from "./workloads";
import { variants } from "./workloads";

export type PerVariant<T> = Record<Variant, T>;

export type ResultRow = {
  id: number;
  workload: WorkloadKey;
  params: WorkloadParams;
  /** Workload runs per timed sample. */
  repetitions: number;
  /** Frames in one session (the run each sample times). */
  frames: number;
  samples: PerVariant<number[]>;
  memoryBytes: PerVariant<number>;
  pointerWidths: PerVariant<number>;
  checksumsMatch: boolean;
  context?: RunContext;
  startedAt: number;
  endedAt: number;
};

export type Progress = {
  workload: WorkloadKey;
  phase: string;
  completed: number;
  total: number;
  /** Untimed preparation done, 0..1: load, calibrate, warm up. */
  prep: number;
};

/** Alternate warm-up rounds until both builds have run for this long. The other benchmarks use the shorter MIN_WARMUP_MS from @/lib/bench. */
export const MIN_WARMUP_MS = 500;

export async function runWorkload(
  workload: WorkloadKey,
  params: WorkloadParams,
  sampleCount: number,
  signal: AbortSignal,
  onProgress: (completed: number, phase: string, prep: number) => void,
): Promise<Omit<ResultRow, "id" | "startedAt" | "endedAt">> {
  const rawWorker = new Worker(new URL("./worker", import.meta.url), {
    type: "module",
  });
  const worker = wrap<Memory64Worker>(rawWorker);
  const terminate = () => rawWorker.terminate();
  signal.addEventListener("abort", terminate, { once: true });
  const call = <T,>(promise: Promise<T>) => abortable(promise, signal);

  try {
    const checksums = new Set<number>();
    const run = async (variant: Variant, repetitions: number) => {
      const result = await call(worker.run(variant, repetitions));
      checksums.add(result.checksum);
      return result.elapsedMs;
    };

    // Prepare both builds before running either, so neither gets extra
    // background compilation time while the other is loading.
    onProgress(0, "Loading both builds", 0);
    const pointerWidths = {} as PerVariant<number>;
    let frames = 0;
    for (const variant of variants) {
      const prepared = await call(worker.prepare(variant, workload, params));
      pointerWidths[variant] = prepared.pointerWidth;
      frames = prepared.frames;
    }

    // Calibrate a repetition count, shared by both builds, that keeps each
    // sample well above timer resolution (which can be 100µs or coarser).
    // Each batch runs both builds, and the faster build sets the count.
    onProgress(0, "Calibrating repetitions", 1 / 3);
    const { repetitions } = await calibrate(async (n) => {
      let fastest = Infinity;
      for (const variant of variants) {
        fastest = Math.min(fastest, await run(variant, n));
      }
      return fastest;
    });

    // Untimed warm-up, alternating builds, so both have tiered up (engines
    // optimize hot functions asynchronously) before measuring.
    onProgress(0, "Warming up both builds", 2 / 3);
    await warmUp(async (round) => {
      let ms = 0;
      for (const variant of round % 2 === 0 ? variants : [...variants].reverse()) {
        ms += await run(variant, repetitions);
      }
      return ms;
    }, MIN_WARMUP_MS);

    const samples: PerVariant<number[]> = { wasm32: [], wasm64: [] };
    for (let i = 0; i < sampleCount; i++) {
      // Alternate which variant goes first to cancel out ordering effects
      // (thermal throttling, GC, background noise).
      const order = i % 2 === 0 ? variants : [...variants].reverse();
      for (const variant of order) {
        samples[variant].push((await run(variant, repetitions)) / repetitions);
      }
      onProgress(i + 1, "Sampling", 1);
    }

    const memoryBytes = {} as PerVariant<number>;
    for (const variant of variants) {
      memoryBytes[variant] = await call(worker.memoryBytes(variant));
    }

    return {
      workload,
      params,
      repetitions,
      frames,
      samples,
      memoryBytes,
      pointerWidths,
      checksumsMatch: checksums.size === 1,
    };
  } finally {
    signal.removeEventListener("abort", terminate);
    worker[releaseProxy]();
    terminate();
  }
}
