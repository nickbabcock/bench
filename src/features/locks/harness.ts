import { releaseProxy, wrap } from "comlink";
import { abortable, calibrate, rotate, warmUp } from "@/lib/bench";
import type { RunContext } from "@/lib/context";
import { ITERATIONS, unsupported, type Variant, variants as allVariants, type WorkloadId, workloadIds } from "./workloads";
import type { LocksWorker } from "./worker";
import type { LoadResult } from "./worker/module";

export type ResultRow = {
  id: number;
  /** Inner iterations per driver call. */
  iterations: number;
  /** The builds measured, in page order. */
  variants: Variant[];
  /** Builds this browser could not load, with the reason. */
  skipped: Partial<Record<Variant, string>>;
  /** Each measured build's own report of its flags ("panic=unwind atomics=false"). */
  flags: Partial<Record<Variant, string>>;
  /** Driver calls per timed batch, per workload, shared by every build. */
  calls: Record<WorkloadId, number>;
  /** ns per operation, one per round, per build and workload. */
  samples: Partial<Record<Variant, Record<WorkloadId, number[]>>>;
  /** Every build computed the same digest for every workload. Always true: a run whose builds disagree stops before timing. */
  checksumsMatch: true;
  context?: RunContext;
  startedAt: number;
  endedAt: number;
};

export type Progress = {
  phase: string;
  completed: number;
  total: number;
  /** Untimed preparation done, 0..1: load, calibrate, warm up. */
  prep: number;
};

type Cell = { variant: Variant; workload: WorkloadId };

/**
 * Run every workload in every build this browser supports. A round times
 * each (build, workload) cell once. Each round starts one cell later than
 * the round before, so drift and order spread over all cells. Every cell runs in
 * every round, so any two cells pair round by round.
 */
export async function runLocks(
  sampleCount: number,
  signal: AbortSignal,
  onProgress: (completed: number, phase: string, prep: number) => void,
): Promise<Omit<ResultRow, "id" | "startedAt" | "endedAt">> {
  const rawWorker = new Worker(new URL("./worker", import.meta.url), { type: "module" });
  const worker = wrap<LocksWorker>(rawWorker);
  const terminate = () => rawWorker.terminate();
  signal.addEventListener("abort", terminate, { once: true });
  const call = <T,>(promise: Promise<T>) => abortable(promise, signal);

  try {
    onProgress(0, "Loading the builds", 0);
    const variants: Variant[] = [];
    const skipped: Partial<Record<Variant, string>> = {};
    const flags: Partial<Record<Variant, string>> = {};
    for (const v of allVariants) {
      const reason = unsupported(v);
      if (reason) {
        skipped[v] = reason;
        continue;
      }
      const loaded = await call<LoadResult>(worker.load(v));
      if (loaded.ok) {
        variants.push(v);
        flags[v] = loaded.flags;
      } else if (v === "abort") {
        throw new Error(`The default build failed to load: ${loaded.error}`);
      } else {
        skipped[v] = loaded.error;
      }
    }

    // Every build must compute the same thing before any of it is timed:
    // a run whose builds disagree stops here, so no figure shows its times.
    for (const w of workloadIds) {
      const digests = new Map<Variant, number>();
      for (const v of variants) {
        digests.set(v, await call(worker.checksum(v, w, ITERATIONS)));
        await call(worker.prepare(v, w));
      }
      if (new Set(digests.values()).size > 1) {
        throw new Error(`The builds computed different digests for ${w}: ${[...digests].map(([v, d]) => `${v} ${d}`).join(", ")}`);
      }
    }

    // One call count per workload, shared by every build: the fastest build
    // sets it, so each batch of every build clears the timer by a margin.
    onProgress(0, "Calibrating batches", 1 / 3);
    const calls = {} as Record<WorkloadId, number>;
    for (const w of workloadIds) {
      const { repetitions } = await calibrate(async (n) => {
        let fastest = Infinity;
        for (const v of variants) {
          fastest = Math.min(fastest, await call(worker.run(v, w, ITERATIONS, n)));
        }
        return fastest;
      });
      calls[w] = repetitions;
    }

    const cells: Cell[] = variants.flatMap((variant) => workloadIds.map((workload) => ({ variant, workload })));
    const round = async (index: number, record?: (c: Cell, ms: number) => void) => {
      let total = 0;
      for (const c of rotate(cells, index)) {
        const ms = await call(worker.run(c.variant, c.workload, ITERATIONS, calls[c.workload]));
        total += ms;
        record?.(c, ms);
      }
      return total;
    };

    // Untimed warm-up, whole rounds, so every cell has tiered up.
    onProgress(0, "Warming up", 2 / 3);
    await warmUp((i) => round(i));

    const samples: Partial<Record<Variant, Record<WorkloadId, number[]>>> = Object.fromEntries(
      variants.map((v) => [v, Object.fromEntries(workloadIds.map((w) => [w, [] as number[]]))]),
    );
    for (let i = 0; i < sampleCount; i++) {
      await round(i, (c, ms) => samples[c.variant]![c.workload].push((ms * 1e6) / (calls[c.workload] * ITERATIONS)));
      onProgress(i + 1, "Sampling", 1);
    }

    return { iterations: ITERATIONS, variants, skipped, flags, calls, samples, checksumsMatch: true };
  } finally {
    signal.removeEventListener("abort", terminate);
    worker[releaseProxy]();
    terminate();
  }
}
