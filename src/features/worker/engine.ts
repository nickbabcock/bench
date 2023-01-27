import wasmPath from "../../../packages/alloc/pkg/alloc_bg.wasm";
import init, * as wasmModule from "../../../packages/alloc/pkg/alloc";
import { timeit } from "@/lib/timeit";
import { formatFloat } from "@/lib/format";

export type BenchmarkResult = {
  elapsedMs: number;
};

let wasmInitialized: Promise<wasmModule.InitOutput> | undefined = undefined;
async function initializeWasm() {
  if (wasmInitialized === undefined) {
    wasmInitialized = timeit(() => init(wasmPath)).then(([out, elapsedMs]) => {
      console.log(`initialized wasm: ${formatFloat(elapsedMs)}ms`);
      return out;
    });
  }
  await wasmInitialized;
}

export async function initialize() {
  await initializeWasm();
}

export async function allocation(
  corpus: string,
  iterations: number
): Promise<BenchmarkResult> {
  await initialize();

  const [_, elapsedMs] = await timeit(() =>
    wasmModule.allocation(corpus, iterations)
  );

  return { elapsedMs };
}
