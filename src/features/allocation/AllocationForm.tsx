import { Button } from "@/components/Button";
import { formatFloat } from "@/lib/format";
import { useId, useState } from "react";
import { BenchmarkResult } from "./worker/module";
import { wrap, releaseProxy } from "comlink";
import type { WasmWorker } from "./worker";

type ComparisonResult = {
  standard: BenchmarkResult;
  bump: BenchmarkResult;
  talc: BenchmarkResult;
};

const runBenchmarks = async (
  text: string,
  iterations: number,
): Promise<ComparisonResult> => {
  const rawWorker = new Worker(new URL("./worker", import.meta.url));
  const worker = wrap<WasmWorker>(rawWorker);

  try {
    const standard = await worker.allocation(text, iterations);
    const bump = await worker.bumpAllocation(text, iterations);
    const talc = await worker.talcAllocation(text, iterations);
    return { standard, bump, talc };
  } finally {
    worker[releaseProxy]();
    rawWorker.terminate();
  }
};

export const AllocationForm: React.FC<{}> = () => {
  const [text, setText] = useState("helloworld");
  const [iterations, setIterations] = useState(100_000);
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const inputId = useId();
  const iterationsId = useId();

  const runBenchmark = async () => {
    const result = await runBenchmarks(text, iterations);
    setResults([result, ...results]);
  };

  return (
    <div className="flex flex-col space-y-6">
      <div className="mx-auto grid w-full max-w-md grid-cols-[90px_1fr] items-center gap-y-4">
        <label htmlFor={inputId} className="text-gray-700 dark:text-gray-300">
          Text:
        </label>
        <input
          id={inputId}
          className="h-10 rounded-sm border border-slate-500 px-4 text-lg dark:bg-gray-700 dark:text-white"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <label
          htmlFor={iterationsId}
          className="text-gray-700 dark:text-gray-300"
        >
          Iterations:
        </label>
        <input
          id={iterationsId}
          className="h-10 rounded-sm border border-slate-500 px-4 text-lg dark:bg-gray-700 dark:text-white"
          value={iterations}
          onChange={(e) => setIterations(+e.target.value)}
        />
      </div>

      <div className="flex justify-center">
        <Button className="w-32" onClick={runBenchmark}>
          Run
        </Button>
      </div>

      {results.length > 0 && (
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <div className="grid grid-cols-4 gap-4 border-b pb-2 font-semibold dark:border-gray-600">
            <div>Run</div>
            <div>Dlmalloc Alloc</div>
            <div>Bumpalo Alloc</div>
            <div>Talc Alloc</div>
          </div>
          {results.map((result, i) => (
            <div key={i} className="grid grid-cols-4 gap-4">
              <div>#{results.length - i}</div>
              <div>{formatFloat(result.standard.elapsedMs)}ms</div>
              <div>{formatFloat(result.bump.elapsedMs)}ms</div>
              <div>{formatFloat(result.talc.elapsedMs)}ms</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
