import allocWasmPath from "@/wasm/alloc_bg.wasm?url";
import allocBumpaloWasmPath from "@/wasm/alloc_bumpalo_bg.wasm?url";
import allocBumpScopeWasmPath from "@/wasm/alloc_bump_scope_bg.wasm?url";
import allocTalcWasmPath from "@/wasm/alloc_talc_bg.wasm?url";
import type { Allocator } from "../allocators";

/** The exports every allocation module shares (packages/alloc-workload). */
type Glue = {
  default: (args: { module_or_path: string }) => Promise<{ memory: WebAssembly.Memory }>;
  load_documents: (input: Uint8Array) => Uint32Array;
  rejected_documents: () => number;
  process_documents: () => number;
  allocation_profile: () => Float64Array;
};

type Loaded = { glue: Glue; memory: WebAssembly.Memory; checksum?: number };

const modules: Record<Allocator, { js: () => Promise<unknown>; wasm: string }> = {
  dlmalloc: { js: () => import("@/wasm/alloc"), wasm: allocWasmPath },
  talc: { js: () => import("@/wasm/alloc_talc"), wasm: allocTalcWasmPath },
  bumpalo: { js: () => import("@/wasm/alloc_bumpalo"), wasm: allocBumpaloWasmPath },
  "bump-scope": { js: () => import("@/wasm/alloc_bump_scope"), wasm: allocBumpScopeWasmPath },
};

const loaded = new Map<Allocator, Loaded>();

const PAGE = 64 * 1024;
const pagesOf = (m: Loaded) => m.memory.buffer.byteLength / PAGE;

const get = (allocator: Allocator) => {
  const m = loaded.get(allocator);
  if (!m) {
    throw new Error(`${allocator} has not been prepared`);
  }
  return m;
};

/** Every batch must give the same checksum; a different one means a wrong result. */
function check(allocator: Allocator, m: Loaded, checksum: number) {
  m.checksum ??= checksum;
  if (checksum !== m.checksum) {
    throw new Error(`${allocator} returned a different checksum`);
  }
}

export type Prepared = {
  /** Document sizes in bytes, in processing order. */
  sizes: number[];
  rejected: number;
  /** Linear memory, in 64 KiB pages, once the input is loaded: the baseline. */
  baselinePages: number;
};

/**
 * Instantiate the allocator's module in this fresh worker and hand it the
 * input once (untimed). Nothing has run yet, so the page count is the
 * post-load baseline.
 */
export async function prepare(allocator: Allocator, input: Uint8Array): Promise<Prepared> {
  if (loaded.has(allocator)) {
    throw new Error(`${allocator} is already loaded; heap growth needs a fresh instance`);
  }
  const { js, wasm } = modules[allocator];
  const glue = (await js()) as Glue;
  const { memory } = await glue.default({ module_or_path: wasm });
  const m: Loaded = { glue, memory };
  loaded.set(allocator, m);
  const sizes = Array.from(glue.load_documents(input));
  return { sizes, rejected: glue.rejected_documents(), baselinePages: pagesOf(m) };
}

export type Fixed = {
  /** The first batch on the fresh instance: cold code, and it pays memory.grow. */
  coldMs: number;
  /** Pages after the fixed sequence of batches. */
  pages: number;
  checksum: number;
};

/**
 * The fixed sequence: `batches` batches on the fresh instance, before any
 * calibration, so heap growth is the same sequence in every module.
 */
export function fixedSequence(allocator: Allocator, batches: number): Fixed {
  const m = get(allocator);
  const start = performance.now();
  let checksum = m.glue.process_documents();
  const coldMs = performance.now() - start;
  check(allocator, m, checksum);
  for (let i = 1; i < batches; i++) {
    checksum = m.glue.process_documents();
    check(allocator, m, checksum);
  }
  return { coldMs, pages: pagesOf(m), checksum };
}

/** One untimed batch through a counting wrapper: calls and bytes asked of the allocator. */
export function profile(allocator: Allocator) {
  const [allocs, grows, shrinks, frees, bytes] = Array.from(get(allocator).glue.allocation_profile());
  return { allocs, grows, shrinks, frees, bytes };
}

/**
 * Run `repetitions` batches back to back and return the total elapsed
 * milliseconds, so each sample clears timer resolution. Checksums are
 * checked after the clock stops.
 */
export function time(allocator: Allocator, repetitions: number): number {
  const m = get(allocator);
  const sums = new Uint32Array(repetitions);
  const start = performance.now();
  for (let i = 0; i < repetitions; i++) {
    sums[i] = m.glue.process_documents();
  }
  const elapsedMs = performance.now() - start;
  for (const s of sums) {
    check(allocator, m, s);
  }
  return elapsedMs;
}

/** Linear memory, in pages, now. */
export const pages = (allocator: Allocator) => pagesOf(get(allocator));
