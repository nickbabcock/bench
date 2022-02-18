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
      <button onClick={runBenchmark}>Run</button>
      <ul>
        {results.map((x, i) => (
          <li key={i}>{formatFloat(x.elapsedMs)}ms</li>
        ))}
      </ul>
    </div>
  );
};
