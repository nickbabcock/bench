import { Button } from "@/components/Button";
import { releaseProxy, transfer, wrap } from "comlink";
import { useReducer, useRef, useState } from "react";
import { FileInput } from "@/components/FileInput";
import type { WasmWorker } from "./worker";
import { ResultChart } from "./ResultChart";
import { ResultTable } from "./ResultTable";
import { DocumentIcon } from "@/components/icons";
import { BenchmarkProfile, CompressionProfileData } from "./types";
import { useIsomorphicLayoutEffect } from "@/hooks";
import { useActions, useAlgorithms } from "./store";

type CompressionState =
  | {
      kind: "initial";
    }
  | {
      kind: "running" | "finished";
      filename: string;
      bytes: number;
      status?: string;
      results: BenchmarkProfile[];
    };

type CompressionAction =
  | ({
      kind: "new-file";
    } & NewFileAction)
  | {
      kind: "status";
      status: string;
    }
  | {
      kind: "new-result";
      result: BenchmarkProfile;
    }
  | { kind: "finish" };

type NewFileAction = {
  filename: string;
  bytes: number;
};

function compressionReducer(
  state: CompressionState,
  action: CompressionAction,
): CompressionState {
  switch (action.kind) {
    case "new-file": {
      return {
        kind: "running",
        filename: action.filename,
        bytes: action.bytes,
        results: [],
      };
    }
    case "status": {
      if (state.kind !== "running") {
        throw new Error("Must be running to update status");
      }
      return { ...state, status: action.status };
    }
    case "new-result": {
      if (state.kind !== "running") {
        throw new Error("Must be running to update results");
      }
      return {
        ...state,
        results: [...state.results, action.result],
      };
    }
    case "finish": {
      if (state.kind !== "running") {
        throw new Error("Must be running to finish");
      }

      return {
        ...state,
        kind: "finished",
      };
    }
  }
}

const useCompressionResults = () => {
  const [state, dispatch] = useReducer(compressionReducer, { kind: "initial" });
  const newFile = (args: NewFileAction) =>
    dispatch({ kind: "new-file", ...args });
  const newStatus = (status: string) => dispatch({ kind: "status", status });
  const newCompressionResult = (result: CompressionProfileData) =>
    dispatch({
      kind: "new-result",
      result: { action: "compression", ...result },
    });
  const newDecompressionResult = (result: {
    algorithm: string;
    elapsedMs: number;
  }) =>
    dispatch({
      kind: "new-result",
      result: { action: "decompression", ...result },
    });
  const finish = () => dispatch({ kind: "finish" });
  return {
    state,
    newFile,
    newStatus,
    newCompressionResult,
    finish,
    newDecompressionResult,
  };
};

type RunCompressionHookProps = {
  iterations: number;
};

const useRunCompressionBenchmarks = ({
  iterations,
}: RunCompressionHookProps) => {
  const {
    state,
    newFile,
    newStatus,
    newCompressionResult,
    finish,
    newDecompressionResult,
  } = useCompressionResults();

  const algorithms = useAlgorithms();

  const [isCancelling, setCancelling] = useState(false);
  const cancelSignal = useRef(isCancelling);
  useIsomorphicLayoutEffect(() => {
    cancelSignal.current = isCancelling;
  });

  const run = async (file: File) => {
    cancelSignal.current = false;
    const rawWorker = new Worker(new URL("./worker", import.meta.url));
    const worker = wrap<WasmWorker>(rawWorker);
    const data = new Uint8Array(await file.arrayBuffer());

    newFile({ bytes: data.length, filename: file.name });

    if ("CompressionStream" in window && algorithms.native.enabled) {
      for (let i = 0; i < iterations && !cancelSignal.current; i++) {
        newStatus(`Compression Streams: (${i + 1}/${iterations})`);
        const comp = await worker.nativeCompress(data);
        newCompressionResult({
          algorithm: "native",
          elapsedMs: comp.elapsedMs,
          size: comp.out.length,
        });

        const decomp = await worker.nativeDecompress(
          transfer(comp.out, [comp.out.buffer]),
        );
        newDecompressionResult({
          algorithm: "native",
          elapsedMs: decomp.elapsedMs,
        });
      }
    }

    if (algorithms.lz4.enabled) {
      for (let i = 0; i < iterations && !cancelSignal.current; i++) {
        newStatus(`lz4: (${i + 1}/${iterations})`);
        const comp = await worker.lz4Compress(data);
        newCompressionResult({
          algorithm: "lz4",
          elapsedMs: comp.elapsedMs,
          size: comp.out.length,
        });

        const decomp = await worker.lz4Decompress(
          transfer(comp.out, [comp.out.buffer]),
        );
        newDecompressionResult({
          algorithm: "lz4",
          elapsedMs: decomp.elapsedMs,
        });
      }
    }

    if (algorithms.zstd.enabled) {
      for (let level of [1, 3, 5, 7]) {
        for (let i = 0; i < iterations && !cancelSignal.current; i++) {
          const algorithm = `zstd-${level}`;
          newStatus(`${algorithm}: (${i + 1}/${iterations})`);
          const comp = await worker.zstdCompress(data, level);
          newCompressionResult({
            algorithm: algorithm,
            elapsedMs: comp.elapsedMs,
            size: comp.out.length,
          });

          const decomp = await worker.zstdDecompress(
            transfer(comp.out, [comp.out.buffer]),
          );
          newDecompressionResult({
            algorithm: algorithm,
            elapsedMs: decomp.elapsedMs,
          });
        }
      }
    }

    let deflatePayload: Uint8Array | undefined = undefined;

    if (algorithms.miniz.enabled) {
      // Best Speed, Default, and Best Compression
      for (let level of [1, 6, 9]) {
        for (let i = 0; i < iterations && !cancelSignal.current; i++) {
          const algorithm = `miniz-${level}`;
          newStatus(`${algorithm}: (${i + 1}/${iterations})`);
          const comp = await worker.minizCompress(data, level);
          newCompressionResult({
            algorithm: algorithm,
            elapsedMs: comp.elapsedMs,
            size: comp.out.length,
          });

          if (level === 6 && i === 0 && deflatePayload === undefined) {
            deflatePayload = new Uint8Array(comp.out);
          }

          const decomp = await worker.minizDecompress(
            transfer(comp.out, [comp.out.buffer]),
          );
          newDecompressionResult({
            algorithm: algorithm,
            elapsedMs: decomp.elapsedMs,
          });
        }
      }
    }

    if (algorithms.zune.enabled) {
      if (deflatePayload) {
        for (let i = 0; i < iterations && !cancelSignal.current; i++) {
          newStatus(`zune deflate: (${i + 1}/${iterations})`);
          const comp = await worker.zuneDecompress(deflatePayload);
          newDecompressionResult({
            algorithm: "zune",
            elapsedMs: comp.elapsedMs,
          });
        }
      }
    }

    if (algorithms.libdeflate.enabled) {
      for (let level of [1, 6, 9]) {
        for (let i = 0; i < iterations && !cancelSignal.current; i++) {
          const algorithm = `libdeflate-${level}`;
          newStatus(`${algorithm}: (${i + 1}/${iterations})`);
          const comp = await worker.libdeflateCompress(data, level);
          newCompressionResult({
            algorithm: algorithm,
            elapsedMs: comp.elapsedMs,
            size: comp.out.length,
          });

          const decomp = await worker.libdeflateDecompress(
            transfer(comp.out, [comp.out.buffer]),
          );
          newDecompressionResult({
            algorithm: algorithm,
            elapsedMs: decomp.elapsedMs,
          });
        }
      }
    }

    if (algorithms.zlibrs.enabled) {
      for (let level of [1, 6, 9]) {
        for (let i = 0; i < iterations && !cancelSignal.current; i++) {
          const algorithm = `zlibrs-${level}`;
          newStatus(`${algorithm}: (${i + 1}/${iterations})`);
          const comp = await worker.zlibrsCompress(data, level);
          newCompressionResult({
            algorithm: algorithm,
            elapsedMs: comp.elapsedMs,
            size: comp.out.length,
          });

          const decomp = await worker.zlibrsDecompress(
            transfer(comp.out, [comp.out.buffer]),
          );
          newDecompressionResult({
            algorithm: algorithm,
            elapsedMs: decomp.elapsedMs,
          });
        }
      }
    }

    if (algorithms.brotli.enabled) {
      for (let level of [1, 4, 9]) {
        for (let i = 0; i < iterations && !cancelSignal.current; i++) {
          const algorithm = `brotli-${level}`;
          newStatus(`${algorithm}: (${i + 1}/${iterations})`);
          const comp = await worker.brotliCompress(data, level);
          newCompressionResult({
            algorithm,
            elapsedMs: comp.elapsedMs,
            size: comp.out.length,
          });

          const decomp = await worker.brotliDecompress(
            transfer(comp.out, [comp.out.buffer]),
          );
          newDecompressionResult({ algorithm, elapsedMs: decomp.elapsedMs });
        }
      }
    }

    if (algorithms.pako.enabled) {
      for (let level of [1, 6, 9] as const) {
        for (let i = 0; i < iterations && !cancelSignal.current; i++) {
          const algorithm = `pako-${level}`;
          newStatus(`${algorithm}: (${i + 1}/${iterations})`);
          const comp = await worker.pakoCompress(data, level);
          newCompressionResult({
            algorithm,
            elapsedMs: comp.elapsedMs,
            size: comp.out.length,
          });

          const decomp = await worker.pakoDecompress(
            transfer(comp.out, [comp.out.buffer]),
          );
          newDecompressionResult({ algorithm, elapsedMs: decomp.elapsedMs });
        }
      }
    }

    if (algorithms.fflate.enabled) {
      for (let level of [1, 6, 9] as const) {
        for (let i = 0; i < iterations && !cancelSignal.current; i++) {
          const algorithm = `fflate-${level}`;
          newStatus(`${algorithm}: (${i + 1}/${iterations})`);
          const comp = await worker.fflateCompress(data, level);
          newCompressionResult({
            algorithm,
            elapsedMs: comp.elapsedMs,
            size: comp.out.length,
          });

          const decomp = await worker.fflateDecompress(
            transfer(comp.out, [comp.out.buffer]),
          );
          newDecompressionResult({ algorithm, elapsedMs: decomp.elapsedMs });
        }
      }
    }

    setCancelling(false);
    finish();

    worker[releaseProxy]();
    rawWorker.terminate();
  };

  return {
    state,
    isCancelling,
    setCancelling,
    run,
  };
};

export const Compression = () => {
  const iterations = 3;
  const { state, isCancelling, setCancelling, run } =
    useRunCompressionBenchmarks({ iterations: 3 });
  const algorithms = useAlgorithms();
  const { setAlgorithmEnabled } = useActions();

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-4 self-center">
        <div>
          <label className="flex gap-1">
            <input
              type="checkbox"
              aria-label="Enable lz4"
              checked={algorithms.native.enabled}
              onChange={(e) =>
                setAlgorithmEnabled("native", e.currentTarget.checked)
              }
            />
            <h3 className="inline-block text-lg font-semibold">Native</h3>
          </label>
        </div>
        <div>
          <label className="flex gap-1">
            <input
              type="checkbox"
              aria-label="Enable lz4"
              checked={algorithms.lz4.enabled}
              onChange={(e) =>
                setAlgorithmEnabled("lz4", e.currentTarget.checked)
              }
            />
            <h3 className="inline-block text-lg font-semibold">lz4</h3>
          </label>
        </div>
        <div>
          <label className="flex gap-1">
            <input
              type="checkbox"
              aria-label="Enable zstd"
              checked={algorithms.zstd.enabled}
              onChange={(e) =>
                setAlgorithmEnabled("zstd", e.currentTarget.checked)
              }
            />
            <h3 className="inline-block text-lg font-semibold">zstd</h3>
          </label>
        </div>
        <div>
          <label className="flex gap-1">
            <input
              type="checkbox"
              aria-label="Enable miniz"
              checked={algorithms.miniz.enabled}
              onChange={(e) =>
                setAlgorithmEnabled("miniz", e.currentTarget.checked)
              }
            />
            <h3 className="inline-block text-lg font-semibold">miniz</h3>
          </label>
        </div>
        <div>
          <label className="flex gap-1">
            <input
              type="checkbox"
              aria-label="Enable pako"
              checked={algorithms.pako.enabled}
              onChange={(e) =>
                setAlgorithmEnabled("pako", e.currentTarget.checked)
              }
            />
            <h3 className="inline-block text-lg font-semibold">pako</h3>
          </label>
        </div>
        <div>
          <label className="flex gap-1">
            <input
              type="checkbox"
              aria-label="Enable fflate"
              checked={algorithms.fflate.enabled}
              onChange={(e) =>
                setAlgorithmEnabled("fflate", e.currentTarget.checked)
              }
            />
            <h3 className="inline-block text-lg font-semibold">fflate</h3>
          </label>
        </div>
        <div>
          <label className="flex gap-1">
            <input
              type="checkbox"
              aria-label="Enable brotli"
              checked={algorithms.brotli.enabled}
              onChange={(e) =>
                setAlgorithmEnabled("brotli", e.currentTarget.checked)
              }
            />
            <h3 className="inline-block text-lg font-semibold">brotli</h3>
          </label>
        </div>
        <div>
          <label className="flex gap-1">
            <input
              type="checkbox"
              aria-label="Enable zune"
              checked={algorithms.zune.enabled}
              onChange={(e) =>
                setAlgorithmEnabled("zune", e.currentTarget.checked)
              }
            />
            <h3 className="inline-block text-lg font-semibold">zune</h3>
          </label>
        </div>
        <div>
          <label className="flex gap-1">
            <input
              type="checkbox"
              aria-label="Enable libdeflate"
              checked={algorithms.libdeflate.enabled}
              onChange={(e) =>
                setAlgorithmEnabled("libdeflate", e.currentTarget.checked)
              }
            />
            <h3 className="inline-block text-lg font-semibold">libdeflate</h3>
          </label>
        </div>
        <div>
          <label className="flex gap-1">
            <input
              type="checkbox"
              aria-label="Enable zlibrs"
              checked={algorithms.zlibrs.enabled}
              onChange={(e) =>
                setAlgorithmEnabled("zlibrs", e.currentTarget.checked)
              }
            />
            <h3 className="inline-block text-lg font-semibold">zlibrs</h3>
          </label>
        </div>
      </div>
      <FileInput onChange={run}>
        <DocumentIcon className="w-10" />
        <p>
          Drag and drop or{" "}
          <span className="font-bold text-sky-700 dark:text-sky-400">
            browse for a file
          </span>{" "}
          to run compression benchmarks
        </p>
      </FileInput>
      {state.kind === "running" ? (
        <div className="mx-auto flex max-w-prose">
          <p className="grow text-xl">Benchmarking {state.status}</p>
          <div>
            <Button
              className="w-32 text-xl"
              disabled={isCancelling}
              onClick={() => setCancelling(true)}
            >
              {isCancelling ? "Cancelling ..." : "Cancel"}
            </Button>
          </div>
        </div>
      ) : null}
      {state.kind === "running" || state.kind === "finished" ? (
        <div className="my-5 overflow-auto">
          <ResultTable iterations={iterations} {...state} />
        </div>
      ) : null}
      {state.kind === "finished" ? (
        <div className="mx-auto max-w-prose">
          <ResultChart {...state} />
        </div>
      ) : null}
    </>
  );
};
