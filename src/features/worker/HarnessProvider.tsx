import React, { MutableRefObject, useEffect } from "react";
import { Remote, wrap, releaseProxy } from "comlink";
import { WasmWorker } from "./worker";

export type Harness = Remote<WasmWorker>;

interface HarnessState {
  rawWorker: Worker;
  worker: Harness;
}

type ContextState = MutableRefObject<HarnessState | undefined>;

const ReplayParserContext = React.createContext<ContextState | undefined>(
  undefined
);

export const BenchmarkHarnessProvider: React.FC<{}> = ({ children }) => {
  const workerRef = React.useRef<HarnessState>();

  useEffect(() => {
    async function effect() {
      const rawWorker = new Worker(new URL("./worker.ts", import.meta.url));
      const worker = wrap<WasmWorker>(rawWorker);
      workerRef.current = {
        worker,
        rawWorker,
      };
    }

    effect();

    return () => {
      if (workerRef.current) {
        workerRef.current.worker[releaseProxy]();
        workerRef.current.rawWorker.terminate();
        workerRef.current = undefined;
      }
    };
  }, []);

  return (
    <ReplayParserContext.Provider value={workerRef}>
      {children}
    </ReplayParserContext.Provider>
  );
};

export function useBenchmarkHarness() {
  const context = React.useContext(ReplayParserContext);
  if (context === undefined) {
    throw new Error(
      "useBenchmarkHarness must be used within a BenchmarkHarnessProvider"
    );
  }
  return context;
}

export function getHarness(ctx: ContextState) {
  const result = ctx.current?.worker;
  if (result === undefined) {
    throw new Error("expected worker to be defined");
  }

  return result;
}
