import wasm32Path from "@/wasm/memory64_wasm32_bg.wasm?url";
import wasm64Path from "@/wasm/memory64_wasm64_bg.wasm?url";
import type { Variant, WorkloadKey, WorkloadParams } from "../workloads";

type Bindings = typeof import("@/wasm/memory64_wasm32");

type Benchmark = { run(): number; free(): void };

type Loaded = {
  bindings: Bindings;
  memory: WebAssembly.Memory;
};

const loaders: Record<Variant, () => Promise<Bindings>> = {
  wasm32: () => import("@/wasm/memory64_wasm32"),
  wasm64: () => import("@/wasm/memory64_wasm64"),
};

const wasmPaths: Record<Variant, string> = {
  wasm32: wasm32Path,
  wasm64: wasm64Path,
};

const loaded = new Map<Variant, Loaded>();
const benchmarks = new Map<Variant, Benchmark>();

async function load(variant: Variant): Promise<Loaded> {
  const existing = loaded.get(variant);
  if (existing) {
    return existing;
  }

  const bindings = await loaders[variant]();
  const { memory } = await bindings.default({
    module_or_path: wasmPaths[variant],
  });
  const result = { bindings, memory };
  loaded.set(variant, result);
  return result;
}

function create(
  bindings: Bindings,
  workload: WorkloadKey,
  params: WorkloadParams,
): Benchmark {
  switch (workload) {
    case "editor":
      return new bindings.EditorSession(params.entities);
  }
}

export type PrepareResult = {
  pointerWidth: number;
  /** Frames in one session. */
  frames: number;
};

/** Instantiate the module and prepare the workload's inputs (untimed). */
export async function prepare(
  variant: Variant,
  workload: WorkloadKey,
  params: WorkloadParams,
): Promise<PrepareResult> {
  const { bindings } = await load(variant);
  benchmarks.get(variant)?.free();
  benchmarks.set(variant, create(bindings, workload, params));
  return { pointerWidth: bindings.pointer_width(), frames: bindings.EditorSession.frames() };
}

export type RunResult = {
  /** Total time for all repetitions. */
  elapsedMs: number;
  checksum: number;
};

/**
 * Run the prepared workload `repetitions` times back to back and time the
 * whole batch, so short workloads stay well above timer resolution.
 */
export function run(variant: Variant, repetitions: number): RunResult {
  const benchmark = benchmarks.get(variant);
  if (!benchmark) {
    throw new Error(`${variant} workload has not been prepared`);
  }

  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < repetitions; i++) {
    const result = benchmark.run();
    if (i === 0) {
      checksum = result;
    } else if (result !== checksum) {
      throw new Error(`${variant} produced inconsistent checksums`);
    }
  }
  const elapsedMs = performance.now() - start;
  return { elapsedMs, checksum };
}

/** Current (and therefore peak, as wasm memory never shrinks) memory size. */
export function memoryBytes(variant: Variant): number {
  return loaded.get(variant)?.memory.buffer.byteLength ?? 0;
}
