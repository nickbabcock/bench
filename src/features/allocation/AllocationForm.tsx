import { Button } from "@/components/Button";
import { formatFloat } from "@/lib/format";
import { useId, useState } from "react";
import { BenchmarkResult } from "./worker/module";
import { wrap, releaseProxy } from "comlink";
import type { WasmWorker } from "./worker";

type ComparisonResult = {
  standard: BenchmarkResult;
  bumpalo: BenchmarkResult;
  bumpScope: BenchmarkResult;
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
    const bumpalo = await worker.bumpaloAllocation(text, iterations);
    const bumpScope = await worker.bumpScopeAllocation(text, iterations);
    const talc = await worker.talcAllocation(text, iterations);
    return { standard, bumpalo, bumpScope, talc };
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
        <table className="mx-auto">
          <thead>
            <tr className="border-b dark:border-gray-600">
              <th className="px-6 py-2 text-left font-semibold">Run</th>
              <th className="px-6 py-2 text-right font-semibold">Dlmalloc</th>
              <th className="px-6 py-2 text-right font-semibold">Bumpalo</th>
              <th className="px-6 py-2 text-right font-semibold">Bump-Scope</th>
              <th className="px-6 py-2 text-right font-semibold">Talc</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, i) => (
              <tr key={i}>
                <td className="px-6 py-2">#{results.length - i}</td>
                <td className="px-6 py-2 text-right">{formatFloat(result.standard.elapsedMs)}ms</td>
                <td className="px-6 py-2 text-right">{formatFloat(result.bumpalo.elapsedMs)}ms</td>
                <td className="px-6 py-2 text-right">{formatFloat(result.bumpScope.elapsedMs)}ms</td>
                <td className="px-6 py-2 text-right">{formatFloat(result.talc.elapsedMs)}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
