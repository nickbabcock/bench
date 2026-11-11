import { releaseProxy, transfer, wrap } from "comlink";
import { abortable, calibrate, rotate, warmUp } from "@/lib/bench";
import { type ConfigSpec, familyInfo } from "./codecs";
import type { WasmWorker } from "./worker";
import type { CodeSize } from "./worker/module";
import type { Progress } from "./types";

export const configLabel = (spec: ConfigSpec) =>
  spec.level === null
    ? familyInfo[spec.family].name
    : `${familyInfo[spec.family].name} ${spec.level}`;

export type Handlers = {
  progress: (progress: Progress) => void;
  prepared: (
    id: string,
    info: {
      size: number;
      roundTrip: boolean;
      zstdParams?: number[];
      code: CodeSize;
      encodeReps: number | null;
      decodeReps: number;
    },
  ) => void;
  sample: (id: string, encodeMs: number | undefined, decodeMs: number) => void;
};


/**
 * Benchmark every configuration against one input.
 *
 * 1. Prepare each configuration untimed: load its code, compress once, and
 *    check that decoding reproduces the input.
 * 2. Calibrate a repetition count per direction so each timed batch lasts at
 *    least MIN_SAMPLE_MS, then warm up untimed so the engine can tier up.
 * 3. Take `samples` rounds. Each round visits every configuration once, in an
 *    order rotated by one per round, so slow drift (thermal throttling, GC,
 *    background work) is spread across configurations instead of landing on
 *    whichever ran last.
 */
export async function runCompression(
  data: Uint8Array<ArrayBuffer>,
  specs: ConfigSpec[],
  samples: number,
  signal: AbortSignal,
  on: Handlers,
) {
  const rawWorker = new Worker(new URL("./worker", import.meta.url), {
    type: "module",
  });
  const worker = wrap<WasmWorker>(rawWorker);
  const terminate = () => rawWorker.terminate();
  signal.addEventListener("abort", terminate, { once: true });
  const call = <T>(promise: Promise<T>) => abortable(promise, signal);

  // Preparing a configuration (calibration plus warm-up) takes several
  // sample-batches' worth of time, so weight it accordingly in progress.
  const PREPARE_WEIGHT = 4;
  const total = specs.length * (PREPARE_WEIGHT + samples);
  let done = 0;
  const report = (phase: string, detail: string, activeId?: string) =>
    on.progress({ phase, detail, done, total, activeId });

  try {
    await call(worker.setInput(transfer(data, [data.buffer])));

    const reps = new Map<string, { encode: number | null; decode: number }>();
    for (const [i, spec] of specs.entries()) {
      report(
        "Preparing and calibrating",
        `${configLabel(spec)} · ${i + 1} of ${specs.length}`,
        spec.id,
      );
      const prepared = await call(worker.prepare(spec));
      const code = await call(worker.codeSize(spec.family));

      let encode: number | null = null;
      if (!familyInfo[spec.family].decodesFrom) {
        const time = (n: number) => call(worker.timeEncode(spec.id, n));
        encode = (await calibrate(time)).repetitions;
        const n = encode;
        await warmUp(() => time(n));
      }

      const timeDecode = (n: number) => call(worker.timeDecode(spec.id, n));
      const decode = (await calibrate(timeDecode)).repetitions;
      await warmUp(() => timeDecode(decode));

      reps.set(spec.id, { encode, decode });
      on.prepared(spec.id, {
        ...prepared,
        code,
        encodeReps: encode,
        decodeReps: decode,
      });
      done += PREPARE_WEIGHT;
    }

    for (let round = 0; round < samples; round++) {
      for (const spec of rotate(specs, round)) {
        report(
          `Sample round ${round + 1} of ${samples}`,
          configLabel(spec),
          spec.id,
        );
        const { encode, decode } = reps.get(spec.id)!;
        const encodeMs =
          encode === null
            ? undefined
            : (await call(worker.timeEncode(spec.id, encode))) / encode;
        const decodeMs =
          (await call(worker.timeDecode(spec.id, decode))) / decode;
        on.sample(spec.id, encodeMs, decodeMs);
        done++;
      }
    }
  } finally {
    signal.removeEventListener("abort", terminate);
    worker[releaseProxy]();
    terminate();
  }
}
