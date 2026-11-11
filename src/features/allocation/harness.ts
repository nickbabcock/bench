import { releaseProxy, wrap } from "comlink";
import { abortable, calibrate, rotate, warmUp } from "@/lib/bench";
import type { RunContext } from "@/lib/context";
import { type Allocator, allocators } from "./allocators";
import type { WasmWorker } from "./worker";

/** Batches in the fixed sequence that heap growth is measured over. */
export const FIXED_BATCHES = 3;
/** The input: the Silesia xml file, a tar of XML documents. */
export const INPUT = "xml" as const;

export type Profile = { allocs: number; grows: number; shrinks: number; frees: number; bytes: number };

export type AllocatorResult = {
  /** Milliseconds per document (batch time ÷ documents), one entry per sample. */
  samples: number[];
  /** Batches per sample. */
  repetitions: number;
  /** The first batch on a fresh instance, per document: cold code, and it pays memory.grow. */
  coldMs: number;
  /** Linear memory in 64 KiB pages: after loading the input, and after the fixed sequence. */
  pages: { baseline: number; after: number };
  /** Allocator calls and bytes in one batch, from an untimed counting pass. */
  profile: Profile;
  /** The batch checksum, the same in every module when results are right. */
  checksum: number;
};

export type AllocationRun = {
  id: number;
  input: typeof INPUT;
  documents: {
    /** Sizes in bytes, in processing order (largest first). */
    sizes: number[];
    /** Tar entries left out because they weren't well-formed XML. */
    rejected: number;
  };
  samples: number;
  fixedBatches: number;
  startedAt: number;
  endedAt: number;
  context?: RunContext;
  results: Record<Allocator, AllocatorResult>;
  /** Whether every module computed the same checksum. */
  checksumsMatch: boolean;
};

export type Progress = { phase: string; detail: string; done: number; total: number };

/** Pages a module's heap grew over the fixed sequence. */
export const growthPages = (r: AllocatorResult) => r.pages.after - r.pages.baseline;

/**
 * All four allocators live in one fresh worker, each in its own Wasm module
 * with its own linear memory. For each: load the input (untimed), run the
 * fixed sequence of batches (heap growth, and the cold first batch), count
 * allocator calls in one untimed batch, then calibrate so a sample lasts
 * at least MIN_SAMPLE_MS and warm up. Samples are taken in rounds that
 * rotate which allocator goes first.
 */
export async function runAllocation(
  input: Uint8Array,
  samples: number,
  signal: AbortSignal,
  onProgress: (p: Progress) => void,
): Promise<Omit<AllocationRun, "id" | "startedAt" | "endedAt">> {
  const rawWorker = new Worker(new URL("./worker", import.meta.url), { type: "module" });
  const worker = wrap<WasmWorker>(rawWorker);
  const terminate = () => rawWorker.terminate();
  signal.addEventListener("abort", terminate, { once: true });
  const call = <T>(p: Promise<T>) => abortable(p, signal);

  // Loading, the fixed sequence, calibration and warm-up outlast several samples; weight them.
  const PREPARE_WEIGHT = 6;
  const total = allocators.length * (PREPARE_WEIGHT + samples);
  let done = 0;
  const report = (phase: string, detail: string) => onProgress({ phase, detail, done, total });

  try {
    const prepared = {} as Record<Allocator, { reps: number; coldMs: number; pages: AllocatorResult["pages"]; profile: Profile; checksum: number }>;
    let documents: AllocationRun["documents"] | undefined;
    for (const allocator of allocators) {
      report("Loading the documents and measuring heap growth", allocator);
      const p = await call(worker.prepare(allocator, input));
      documents ??= { sizes: p.sizes, rejected: p.rejected };
      const fixed = await call(worker.fixedSequence(allocator, FIXED_BATCHES));
      const profile = await call(worker.profile(allocator));
      report("Calibrating and warming up", allocator);
      const time = (n: number) => call(worker.time(allocator, n));
      const { repetitions } = await calibrate(time);
      await warmUp(() => time(repetitions));
      const count = p.sizes.length;
      prepared[allocator] = {
        reps: repetitions,
        coldMs: fixed.coldMs / count,
        pages: { baseline: p.baselinePages, after: fixed.pages },
        profile,
        checksum: fixed.checksum,
      };
      done += PREPARE_WEIGHT;
    }
    const count = documents!.sizes.length;

    const perDocument = Object.fromEntries(allocators.map((a) => [a, [] as number[]])) as Record<Allocator, number[]>;
    for (let round = 0; round < samples; round++) {
      for (const allocator of rotate(allocators, round)) {
        report(`Sample round ${round + 1} of ${samples}`, allocator);
        const elapsed = await call(worker.time(allocator, prepared[allocator].reps));
        perDocument[allocator].push(elapsed / prepared[allocator].reps / count);
        done++;
      }
    }

    const results = Object.fromEntries(
      allocators.map((a) => {
        const p = prepared[a];
        return [a, { samples: perDocument[a], repetitions: p.reps, coldMs: p.coldMs, pages: p.pages, profile: p.profile, checksum: p.checksum } satisfies AllocatorResult];
      }),
    ) as Record<Allocator, AllocatorResult>;
    return {
      input: INPUT,
      documents: documents!,
      samples,
      fixedBatches: FIXED_BATCHES,
      results,
      checksumsMatch: new Set(allocators.map((a) => results[a].checksum)).size === 1,
    };
  } finally {
    signal.removeEventListener("abort", terminate);
    worker[releaseProxy]();
    terminate();
  }
}
