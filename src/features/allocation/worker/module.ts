import wasmPath from "../../../../packages/alloc/pkg/alloc_bg.wasm";
import { timeit } from "@/lib/timeit";
import { load } from "@/lib/wasm";

export type BenchmarkResult = {
  elapsedMs: number;
};

const alloc = load({
  js: () => import("../../../../packages/alloc/pkg/alloc"),
  wasm: wasmPath,
});

export async function allocation(
  corpus: string,
  iterations: number
): Promise<BenchmarkResult> {
  const mod = await alloc();
  const [_, elapsedMs] = await timeit(() => mod.allocation(corpus, iterations));

  return { elapsedMs };
}
