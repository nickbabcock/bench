import allocWasmPath from "@/wasm/alloc_bg.wasm";
import allocBumpWasmPath from "@/wasm/alloc_bump_bg.wasm";
import allocTalcWasmPath from "@/wasm/alloc_talc_bg.wasm";
import { timeit } from "@/lib/timeit";
import { load } from "@/lib/wasm";

export type BenchmarkResult = {
  elapsedMs: number;
};

const alloc = load({
  js: () => import("@/wasm/alloc"),
  wasm: allocWasmPath,
});

const allocBump = load({
  js: () => import("@/wasm/alloc_bump"),
  wasm: allocBumpWasmPath,
});

const allocTalc = load({
  js: () => import("@/wasm/alloc_talc"),
  wasm: allocTalcWasmPath,
});

export async function allocation(
  corpus: string,
  iterations: number,
): Promise<BenchmarkResult> {
  const mod = await alloc();
  const [_, elapsedMs] = await timeit(() => mod.allocation(corpus, iterations));

  return { elapsedMs };
}

export async function bumpAllocation(
  corpus: string,
  iterations: number,
): Promise<BenchmarkResult> {
  const mod = await allocBump();
  const [_, elapsedMs] = await timeit(() =>
    mod.bump_allocation(corpus, iterations),
  );

  return { elapsedMs };
}

export async function talcAllocation(
  corpus: string,
  iterations: number,
): Promise<BenchmarkResult> {
  const mod = await allocTalc();
  const [_, elapsedMs] = await timeit(() =>
    mod.talc_allocation(corpus, iterations),
  );

  return { elapsedMs };
}
