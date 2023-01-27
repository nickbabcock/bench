import { Button } from "@/components/Button";
import { formatFloat } from "@/lib/format";
import { useId, useState } from "react";
import { BenchmarkResult } from "./engine";
import { getHarness, useBenchmarkHarness } from "./HarnessProvider";

export const AllocationForm: React.FC<{}> = () => {
  const [text, setText] = useState("helloworld");
  const [iterations, setIterations] = useState(100_000);
  const benchmark = useBenchmarkHarness();
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const inputId = useId();
  const iterationsId = useId();

  const runBenchmark = async () => {
    const harness = getHarness(benchmark);
    const result = await harness.allocation(text, iterations);
    setResults([result, ...results]);
  };

  return (
    <div className="mt-5 flex flex-col space-y-4">
      <div className="grid grid-cols-[90px_200px] items-center gap-y-2">
        <label htmlFor={inputId}>Text:</label>
        <input
          id={inputId}
          className="h-10 rounded border border-slate-500 px-4 text-lg"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <label htmlFor={iterationsId}>Iterations:</label>
        <input
          id={iterationsId}
          className="h-10 rounded border border-slate-500 px-4 text-lg"
          value={iterations}
          onChange={(e) => setIterations(+e.target.value)}
        />
      </div>

      <Button className="w-24" onClick={runBenchmark}>
        Run
      </Button>
      <ul>
        {results.map((x, i) => (
          <li key={i}>{formatFloat(x.elapsedMs)}ms</li>
        ))}
      </ul>
    </div>
  );
};
