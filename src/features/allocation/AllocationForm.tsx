import { Button } from "@/components/Button";
import { formatFloat } from "@/lib/format";
import { useId, useState } from "react";
import { BenchmarkResult } from "./worker/module";
import { wrap, releaseProxy } from "comlink";
import type { WasmWorker } from "./worker";

type ComparisonResult = {
  standard: BenchmarkResult;
  bump: BenchmarkResult;
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
    return { standard, bump };
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
    <div className="mt-5 flex flex-col space-y-4">
      <div className="grid grid-cols-[90px_200px] items-center gap-y-2">
        <label htmlFor={inputId}>Text:</label>
        <input
          id={inputId}
          className="h-10 rounded-sm border border-slate-500 px-4 text-lg"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <label htmlFor={iterationsId}>Iterations:</label>
        <input
          id={iterationsId}
          className="h-10 rounded-sm border border-slate-500 px-4 text-lg"
          value={iterations}
          onChange={(e) => setIterations(+e.target.value)}
        />
      </div>

      <Button className="w-24" onClick={runBenchmark}>
        Run
      </Button>

      {results.length > 0 && (
        <div className="max-w-md space-y-4">
          <div className="grid grid-cols-3 gap-4 border-b pb-2 font-semibold">
            <div>Run</div>
            <div>Global Alloc</div>
            <div>Bumpalo Alloc</div>
          </div>
          {results.map((result, i) => (
            <div key={i} className="grid grid-cols-3 gap-4">
              <div>#{results.length - i}</div>
              <div>{formatFloat(result.standard.elapsedMs)}ms</div>
              <div>{formatFloat(result.bump.elapsedMs)}ms</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
