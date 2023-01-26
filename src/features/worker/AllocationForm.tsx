import { formatFloat } from "@/lib/format";
import { useState } from "react";
import { BenchmarkResult } from "./engine";
import { getHarness, useBenchmarkHarness } from "./HarnessProvider";

export const AllocationForm: React.FC<{}> = () => {
  const [text, setText] = useState("helloworld");
  const [iterations, setIterations] = useState(100_000);
  const benchmark = useBenchmarkHarness();
  const [results, setResults] = useState<BenchmarkResult[]>([]);

  const runBenchmark = async () => {
    const harness = getHarness(benchmark);
    const result = await harness.allocation(text, iterations);
    setResults([result, ...results]);
  };

  return (
    <div className="flex flex-col">
      <label>
        Text:
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label>
        Iterations:
        <input
          value={iterations}
          onChange={(e) => setIterations(+e.target.value)}
        />
      </label>
      <button
        className="btn border-2 border-gray-300 bg-gray-50 focus-visible:outline-blue-600 active:bg-gray-200 enabled:hover:border-blue-400 enabled:hover:bg-blue-50 disabled:opacity-40 dark:text-slate-700"
        onClick={runBenchmark}
      >
        Run
      </button>
      <ul>
        {results.map((x, i) => (
          <li key={i}>{formatFloat(x.elapsedMs)}ms</li>
        ))}
      </ul>
    </div>
  );
};
