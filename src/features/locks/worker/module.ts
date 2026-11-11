import abortPath from "@/wasm/locks_abort_bg.wasm?url";
import unwindPath from "@/wasm/locks_unwind_bg.wasm?url";
import atomicsPath from "@/wasm/locks_atomics_bg.wasm?url";
import { type Variant, type WorkloadId, workloadIds } from "../workloads";

/** What every build exports; the atomics build adds thread support on top. */
type Bindings = Pick<typeof import("@/wasm/locks_abort"), "Bench" | "workloads" | "build_flags"> & {
  default: (init: { module_or_path: string }) => Promise<unknown>;
};
type Bench = InstanceType<Bindings["Bench"]>;

const loaders: Record<Variant, () => Promise<Bindings>> = {
  abort: () => import("@/wasm/locks_abort"),
  unwind: () => import("@/wasm/locks_unwind"),
  atomics: () => import("@/wasm/locks_atomics"),
};

const wasmPaths: Record<Variant, string> = {
  abort: abortPath,
  unwind: unwindPath,
  atomics: atomicsPath,
};

const loaded = new Map<Variant, Bindings>();
const benches = new Map<string, Bench>();
const key = (variant: Variant, workload: WorkloadId) => `${variant}\u0000${workload}`;

/** What each build must report about itself (`build_flags` in the crate). */
const expectedFlags: Record<Variant, string> = {
  abort: "panic=abort atomics=false",
  unwind: "panic=unwind atomics=false",
  atomics: "panic=abort atomics=true",
};

export type LoadResult = { ok: true; flags: string } | { ok: false; error: string };

/**
 * Instantiate one build and check that it has exactly the workloads the
 * page expects, in the same order. The flags ("panic=unwind atomics=false")
 * come from the module itself and must match the build asked for, so a
 * mislabelled build does not load.
 */
export async function load(variant: Variant): Promise<LoadResult> {
  try {
    let bindings = loaded.get(variant);
    if (!bindings) {
      bindings = await loaders[variant]();
      await bindings.default({ module_or_path: wasmPaths[variant] });
      loaded.set(variant, bindings);
    }
    const ids = bindings.workloads();
    if (ids.join() !== workloadIds.join()) {
      return { ok: false, error: `${variant} build does not match the page: it has ${ids.join(", ")}` };
    }
    const flags = bindings.build_flags();
    if (flags !== expectedFlags[variant]) {
      return { ok: false, error: `${variant} build reports ${flags}, not ${expectedFlags[variant]}` };
    }
    return { ok: true, flags };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fresh containers for one workload in one build (untimed). */
export function prepare(variant: Variant, workload: WorkloadId) {
  const bindings = loaded.get(variant);
  if (!bindings) {
    throw new Error(`${variant} build is not loaded`);
  }
  benches.get(key(variant, workload))?.free();
  benches.set(key(variant, workload), new bindings.Bench(workload));
}

/**
 * The digest of one call on fresh containers: the same in every build,
 * or a build computed something else.
 */
export function checksum(variant: Variant, workload: WorkloadId, iterations: number): number {
  const bindings = loaded.get(variant)!;
  const bench = new bindings.Bench(workload);
  try {
    return bench.run(iterations, 1);
  } finally {
    bench.free();
  }
}

/** Time `calls` driver calls of `iterations` each, back to back, in ms. */
export function run(variant: Variant, workload: WorkloadId, iterations: number, calls: number): number {
  const bench = benches.get(key(variant, workload));
  if (!bench) {
    throw new Error(`${variant} ${workload} has not been prepared`);
  }
  const start = performance.now();
  bench.run(iterations, calls);
  return performance.now() - start;
}
