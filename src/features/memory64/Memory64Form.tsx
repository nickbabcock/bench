import { Button } from "@/components/Button";
import { formatFloat } from "@/lib/format";
import { clsx } from "clsx";
import { releaseProxy, wrap } from "comlink";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Memory64Worker } from "./worker";
import {
  defaultParams,
  supportsMemory64,
  type Variant,
  variants,
  type WorkloadKey,
  workloadKeys,
  type WorkloadParam,
  type WorkloadParams,
  workloads,
} from "./workloads";

type PerVariant<T> = Record<Variant, T>;

type ResultRow = {
  id: number;
  workload: WorkloadKey;
  params: WorkloadParams;
  /** Workload runs per timed sample. */
  repetitions: number;
  samples: PerVariant<number[]>;
  memoryBytes: PerVariant<number>;
  pointerWidths: PerVariant<number>;
  checksumsMatch: boolean;
};

type Progress = {
  workload: WorkloadKey;
  completed: number;
  total: number;
};

const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const formatDuration = (ms: number) =>
  ms < 1 ? `${formatFloat(ms * 1000)}µs` : `${formatFloat(ms)}ms`;

const formatMiB = (bytes: number) => `${formatFloat(bytes / 1024 / 1024)} MiB`;

const integerFormatter = new Intl.NumberFormat();

/** Each timed sample batches enough repetitions to last at least this long. */
const MIN_SAMPLE_MS = 50;
const MAX_REPETITIONS = 1_000_000;
/** Alternate warm-up rounds until both builds have run for this long. */
const MIN_WARMUP_MS = 500;
const MIN_WARMUP_ROUNDS = 2;
const MAX_WARMUP_ROUNDS = 20;

/** Reject when `signal` aborts, even if `promise` never settles. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function runWorkload(
  workload: WorkloadKey,
  params: WorkloadParams,
  sampleCount: number,
  signal: AbortSignal,
  onProgress: (completed: number) => void,
): Promise<Omit<ResultRow, "id">> {
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
    const pointerWidths = {} as PerVariant<number>;
    for (const variant of variants) {
      const prepared = await call(worker.prepare(variant, workload, params));
      pointerWidths[variant] = prepared.pointerWidth;
    }

    // Calibrate a repetition count, shared by both builds, that keeps each
    // sample well above timer resolution (which can be 100µs or coarser).
    // Grow the count until a batch of the faster build actually takes long
    // enough: the first, cold runs are much slower than steady state, so a
    // single measurement would underestimate the count.
    let repetitions = 1;
    for (;;) {
      let fastest = Infinity;
      for (const variant of variants) {
        fastest = Math.min(fastest, await run(variant, repetitions));
      }
      if (fastest >= MIN_SAMPLE_MS || repetitions >= MAX_REPETITIONS) {
        break;
      }
      const growth = Math.ceil(MIN_SAMPLE_MS / Math.max(fastest, 0.1));
      repetitions = Math.min(
        MAX_REPETITIONS,
        repetitions * Math.min(Math.max(growth, 2), 10),
      );
    }

    // Untimed warm-up, alternating builds, so both have tiered up (engines
    // optimize hot functions asynchronously) before measuring.
    let warmupMs = 0;
    for (
      let round = 0;
      round < MAX_WARMUP_ROUNDS &&
      (round < MIN_WARMUP_ROUNDS || warmupMs < MIN_WARMUP_MS);
      round++
    ) {
      const order = round % 2 === 0 ? variants : [...variants].reverse();
      for (const variant of order) {
        warmupMs += await run(variant, repetitions);
      }
    }

    const samples: PerVariant<number[]> = { wasm32: [], wasm64: [] };
    for (let i = 0; i < sampleCount; i++) {
      // Alternate which variant goes first to cancel out ordering effects
      // (thermal throttling, GC, background noise).
      const order = i % 2 === 0 ? variants : [...variants].reverse();
      for (const variant of order) {
        samples[variant].push((await run(variant, repetitions)) / repetitions);
      }
      onProgress(i + 1);
    }

    const memoryBytes = {} as PerVariant<number>;
    for (const variant of variants) {
      memoryBytes[variant] = await call(worker.memoryBytes(variant));
    }

    return {
      workload,
      params,
      repetitions,
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

const NumberInput = ({
  param,
  value,
  disabled,
  onChange,
}: {
  param: WorkloadParam;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-gray-700 dark:text-gray-300">
        {param.label}
      </label>
      <input
        id={id}
        type="number"
        min={param.min}
        max={param.max}
        step={1}
        disabled={disabled}
        className="h-10 w-full rounded-sm border border-slate-500 px-3 text-lg disabled:opacity-60 dark:bg-gray-700 dark:text-white"
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </div>
  );
};

const noopSubscribe = () => () => {};

/** `undefined` during prerendering, then whether the browser supports memory64. */
const useMemory64Support = () =>
  useSyncExternalStore<boolean | undefined>(
    noopSubscribe,
    supportsMemory64,
    () => undefined,
  );

const isValidParam = (param: WorkloadParam, value: number) =>
  Number.isInteger(value) && value >= param.min && value <= param.max;

export const Memory64Form = () => {
  const supported = useMemory64Support();
  const [enabled, setEnabled] = useState<Record<WorkloadKey, boolean>>({
    ecs: true,
  });
  const [params, setParams] = useState<Record<WorkloadKey, WorkloadParams>>(
    () =>
      Object.fromEntries(
        workloadKeys.map((key) => [key, defaultParams(key)]),
      ) as Record<WorkloadKey, WorkloadParams>,
  );
  const [sampleCount, setSampleCount] = useState(5);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [progress, setProgress] = useState<Progress | undefined>();
  const [error, setError] = useState<string | undefined>();
  const samplesId = useId();
  const abortRef = useRef<AbortController | null>(null);

  // Stop any in-flight benchmark (and its worker) when leaving the page so it
  // can't compete with a later run.
  useEffect(() => () => abortRef.current?.abort(), []);

  const running = progress !== undefined;
  const selected = workloadKeys.filter((key) => enabled[key]);
  const paramsValid = selected.every((key) =>
    workloads[key].params.every((p: WorkloadParam) =>
      isValidParam(p, params[key][p.key]),
    ),
  );
  const samplesValid =
    Number.isInteger(sampleCount) && sampleCount >= 1 && sampleCount <= 100;
  const canRun =
    supported === true &&
    !running &&
    selected.length > 0 &&
    paramsValid &&
    samplesValid;

  const runBenchmarks = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    setError(undefined);
    try {
      for (const workload of selected) {
        const workloadParams = { ...params[workload] };
        setProgress({ workload, completed: 0, total: sampleCount });
        const row = await runWorkload(
          workload,
          workloadParams,
          sampleCount,
          signal,
          (completed) =>
            setProgress({ workload, completed, total: sampleCount }),
        );
        setResults((prev) => [{ ...row, id: prev.length + 1 }, ...prev]);
      }
    } catch (e) {
      if (!signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!signal.aborted) {
        setProgress(undefined);
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  return (
    <div className="flex flex-col space-y-6">
      {supported === false && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
        >
          This browser does not support WebAssembly memory64, so the wasm64
          builds cannot be loaded. Try a recent version of Chrome or Firefox.
        </div>
      )}

      <div className="grid gap-4">
        {workloadKeys.map((key) => {
          const workload = workloads[key];
          return (
            <fieldset
              key={key}
              className="flex flex-col gap-3 rounded-lg border-2 border-gray-200 bg-gray-50 p-4 has-[legend_input:checked]:border-blue-300 dark:border-gray-700 dark:bg-gray-800 dark:has-[legend_input:checked]:border-blue-600"
            >
              <legend className="px-1">
                <label className="flex cursor-pointer items-center gap-2 font-medium text-gray-900 dark:text-white">
                  <input
                    type="checkbox"
                    checked={enabled[key]}
                    disabled={running}
                    onChange={(e) =>
                      setEnabled((prev) => ({
                        ...prev,
                        [key]: e.target.checked,
                      }))
                    }
                    className="h-4 w-4"
                  />
                  {workload.name}
                </label>
              </legend>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {workload.description}
              </p>
              {workload.params.map((param: WorkloadParam) => (
                <NumberInput
                  key={param.key}
                  param={param}
                  value={params[key][param.key]}
                  disabled={running || !enabled[key]}
                  onChange={(value) =>
                    setParams((prev) => ({
                      ...prev,
                      [key]: { ...prev[key], [param.key]: value },
                    }))
                  }
                />
              ))}
            </fieldset>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end justify-center gap-4">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={samplesId}
            className="text-sm text-gray-700 dark:text-gray-300"
          >
            Samples per build
          </label>
          <input
            id={samplesId}
            type="number"
            min={1}
            max={100}
            step={1}
            disabled={running}
            className="h-10 w-32 rounded-sm border border-slate-500 px-3 text-lg disabled:opacity-60 dark:bg-gray-700 dark:text-white"
            value={sampleCount}
            onChange={(e) => setSampleCount(e.target.valueAsNumber)}
          />
        </div>
        <Button className="w-32" onClick={runBenchmarks} disabled={!canRun}>
          {running ? "Running…" : "Run"}
        </Button>
      </div>

      <p
        className="min-h-6 text-center text-sm text-gray-600 dark:text-gray-400"
        aria-live="polite"
      >
        {progress &&
          `${workloads[progress.workload].name}: sample ${progress.completed} of ${progress.total}`}
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200"
        >
          Benchmark failed: {error}
        </div>
      )}

      {results.length > 0 && <ResultTable results={results} />}
    </div>
  );
};

const ResultTable = ({ results }: { results: ResultRow[] }) => (
  <div className="overflow-x-auto">
    <table className="mx-auto text-sm md:text-base">
      <thead>
        <tr className="border-b dark:border-gray-600">
          <th className="px-4 py-2 text-left font-semibold">Run</th>
          <th className="px-4 py-2 text-left font-semibold">Workload</th>
          <th className="px-4 py-2 text-right font-semibold">wasm32</th>
          <th className="px-4 py-2 text-right font-semibold">wasm64</th>
          <th className="px-4 py-2 text-right font-semibold">
            wasm64 / wasm32
          </th>
          <th className="px-4 py-2 text-right font-semibold">Peak memory</th>
          <th className="px-4 py-2 text-center font-semibold">Output</th>
        </tr>
      </thead>
      <tbody>
        {results.map((row) => (
          <ResultTableRow key={row.id} row={row} />
        ))}
      </tbody>
    </table>
    <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
      Times are per workload run: the median of all samples, with the fastest
      sample below. Short workloads repeat inside each sample to stay above
      timer resolution. Peak memory is the size of each module's linear memory
      after the run.
    </p>
  </div>
);

const ResultTableRow = ({ row }: { row: ResultRow }) => {
  const workload = workloads[row.workload];
  const medians = {
    wasm32: median(row.samples.wasm32),
    wasm64: median(row.samples.wasm64),
  };
  const ratio = medians.wasm64 / medians.wasm32;
  const paramSummary = workload.params
    .map(
      (p: WorkloadParam) =>
        `${p.label}: ${integerFormatter.format(row.params[p.key])}`,
    )
    .join(", ");
  const repetitions =
    row.repetitions > 1
      ? ` · ${integerFormatter.format(row.repetitions)} runs per sample`
      : "";

  return (
    <tr className="border-b border-gray-100 align-top dark:border-gray-700">
      <td className="px-4 py-2">#{row.id}</td>
      <td className="px-4 py-2">
        <div>{workload.name}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {paramSummary}
          {repetitions}
        </div>
      </td>
      {variants.map((variant) => (
        <td key={variant} className="px-4 py-2 text-right whitespace-nowrap">
          <div>{formatDuration(medians[variant])}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            min {formatDuration(Math.min(...row.samples[variant]))}
          </div>
        </td>
      ))}
      <td
        className={clsx(
          "px-4 py-2 text-right font-semibold whitespace-nowrap",
          ratio > 1.02 && "text-red-700 dark:text-red-400",
          ratio < 0.98 && "text-green-700 dark:text-green-400",
        )}
      >
        {formatFloat(ratio)}×
      </td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        {variants.map((variant) => (
          <div key={variant}>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {variant}{" "}
            </span>
            {formatMiB(row.memoryBytes[variant])}
          </div>
        ))}
      </td>
      <td className="px-4 py-2 text-center">
        {row.checksumsMatch ? (
          <span
            className="text-green-700 dark:text-green-400"
            title={`Identical checksums from ${row.pointerWidths.wasm32}-bit and ${row.pointerWidths.wasm64}-bit builds`}
          >
            ✓ identical
          </span>
        ) : (
          <span
            className="text-red-700 dark:text-red-400"
            title="The builds produced different checksums"
          >
            ✗ mismatch
          </span>
        )}
      </td>
    </tr>
  );
};
