import { releaseProxy, wrap } from "comlink";
import { abortable, calibrate, rotate, warmUp } from "@/lib/bench";
import type { RunContext } from "@/lib/context";
import type { BuildWorker } from "./worker";
import { type SubjectKey, type VariantId, variantIds } from "./subjects";

export type PerVariant<T> = Record<VariantId, T>;

export type ResultRow = {
  id: number;
  /** Which visitor run produced the row (rows of one run share it). */
  run?: number;
  subject: SubjectKey;
  input: { name: string; bytes: number };
  /** Bytes each run reads (the encoded payload, for decoders). */
  payloadBytes: number;
  /** Workload runs per timed sample, shared by every variant. */
  repetitions: number;
  /**
   * Per-run milliseconds. Index i of every variant comes from the same
   * round, so samples pair across variants (see results.ts). Includes the
   * A/A control (`off-Os-aa`).
   */
  samples: PerVariant<number[]>;
  /** Every variant produced identical output, and decoders round-tripped. */
  checksumsMatch: boolean;
  context?: RunContext;
  startedAt: number;
  endedAt: number;
};

export async function runSubject(
  subject: SubjectKey,
  input: { name: string; bytes: Uint8Array<ArrayBuffer> },
  sampleCount: number,
  signal: AbortSignal,
  onProgress: (completed: number, phase: string, prep: number) => void,
): Promise<Omit<ResultRow, "id" | "startedAt" | "endedAt">> {
  const rawWorker = new Worker(new URL("./worker", import.meta.url), { type: "module" });
  const worker = wrap<BuildWorker>(rawWorker);
  const terminate = () => rawWorker.terminate();
  signal.addEventListener("abort", terminate, { once: true });
  const call = <T,>(promise: Promise<T>) => abortable(promise, signal);

  try {
    const checksums = new Set<number>();
    const run = async (variant: VariantId, repetitions: number) => {
      const result = await call(worker.run(variant, repetitions));
      checksums.add(result.checksum);
      return result.elapsedMs;
    };

    onProgress(0, "Loading all six builds and the A/A instance", 0);
    const prepared = await call(worker.prepare(subject, input.bytes));

    // One repetition count for every variant, sized so even the fastest
    // variant's batch clears MIN_SAMPLE_MS.
    onProgress(0, "Calibrating repetitions", 1 / 3);
    const { repetitions } = await calibrate(async (reps) => {
      let fastest = Infinity;
      for (const variant of variantIds) {
        fastest = Math.min(fastest, await run(variant, reps));
      }
      return fastest;
    });

    // Untimed warm-up, rotating order, so every variant has tiered up.
    onProgress(0, "Warming up", 2 / 3);
    let round = 0;
    await warmUp(async () => {
      let total = 0;
      for (const variant of rotate(variantIds, round++)) {
        total += await run(variant, repetitions);
      }
      return total;
    });

    const samples = Object.fromEntries(variantIds.map((v) => [v, [] as number[]])) as PerVariant<number[]>;
    for (let i = 0; i < sampleCount; i++) {
      // Each round runs every variant once; rotating who goes first spreads
      // ordering effects (throttling, GC, background noise) evenly.
      for (const variant of rotate(variantIds, i)) {
        samples[variant].push((await run(variant, repetitions)) / repetitions);
      }
      onProgress(i + 1, "Sampling", 1);
    }

    return {
      subject,
      input: { name: input.name, bytes: input.bytes.length },
      payloadBytes: prepared.payloadBytes,
      repetitions,
      samples,
      checksumsMatch: checksums.size === 1 && prepared.roundTrips !== false,
    };
  } finally {
    signal.removeEventListener("abort", terminate);
    worker[releaseProxy]();
    terminate();
  }
}
