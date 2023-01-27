import { Button } from "@/components/Button";
import { formatFloat } from "@/lib/format";
import { transfer, wrap } from "comlink";
import { useMemo, useReducer, useRef, useState } from "react";
import { FileInput } from "./FileInput";
import type { WasmWorker } from "./worker";

type CompressionResults =
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

type CompressionProfileData = {
  algorithm: string;
  elapsedMs: number;
  size: number;
}

type BenchmarkProfile = ({
  action: "compression";
} & CompressionProfileData) | {
  action: "decompression";
  algorithm: string;
  elapsedMs: number;
};

function compressionReducer(
  state: CompressionResults,
  action: CompressionAction
): CompressionResults {
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
    dispatch({ kind: "new-result", result: {action: "compression", ...result} });
  const newDecompressionResult = (result: { algorithm: string; elapsedMs: number }) =>
    dispatch({ kind: "new-result", result: {action: "decompression", ...result} });
  const finish = () => dispatch({ kind: "finish" });
  return { state, newFile, newStatus, newCompressionResult, finish, newDecompressionResult };
};

export const Compression = () => {
  const { state, newFile, newStatus, newCompressionResult, finish, newDecompressionResult } =
    useCompressionResults();

  const [isCancelling, setCancelling] = useState(false);
  const cancelSignal = useRef(isCancelling);
  cancelSignal.current = isCancelling;
  const iterations = 3;

  const onFile = async (file: File) => {
    cancelSignal.current = false;
    const rawWorker = new Worker(new URL("./worker", import.meta.url));
    const worker = wrap<WasmWorker>(rawWorker);
    const data = new Uint8Array(await file.arrayBuffer());

    newFile({ bytes: data.length, filename: file.name });

    if ("CompressionStream" in window) {
      for (let i = 0; i < iterations && !cancelSignal.current; i++) {
        newStatus(`Compression Streams: (${i + 1}/${iterations})`);
        const comp = await worker.nativeCompress(data);
        newCompressionResult({
          algorithm: "native",
          elapsedMs: comp.elapsedMs,
          size: comp.out.length,
        });

        const decomp = await worker.nativeCompress(
          transfer(comp.out, [comp.out.buffer])
        );
        newDecompressionResult({ algorithm: "native", elapsedMs: decomp.elapsedMs });
      }
    }

    for (let i = 0; i < iterations && !cancelSignal.current; i++) {
      newStatus(`lz4: (${i + 1}/${iterations})`);
      const comp = await worker.lz4Compress(data);
      newCompressionResult({
        algorithm: "lz4",
        elapsedMs: comp.elapsedMs,
        size: comp.out.length,
      });

      const decomp = await worker.lz4Decompress(
        transfer(comp.out, [comp.out.buffer])
      );
      newDecompressionResult({ algorithm: "lz4", elapsedMs: decomp.elapsedMs });
    }

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
          transfer(comp.out, [comp.out.buffer])
        );
        newDecompressionResult({ algorithm: algorithm, elapsedMs: decomp.elapsedMs });
      }
    }

    // Best Speed, Default, and Best Compression
    for (let level of [1, 6, 9]) {
      for (let i = 0; i < iterations && !cancelSignal.current; i++) {
        const algorithm = `miniz-${level}`;
        newStatus(`algorithm: (${i + 1}/${iterations})`);
        const comp = await worker.minizCompress(data, level);
        newCompressionResult({
          algorithm: algorithm,
          elapsedMs: comp.elapsedMs,
          size: comp.out.length,
        });
  
        const decomp = await worker.minizDecompress(
          transfer(comp.out, [comp.out.buffer])
        );
        newDecompressionResult({ algorithm: algorithm, elapsedMs: decomp.elapsedMs });
      }
    }

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
          transfer(comp.out, [comp.out.buffer])
        );
        newDecompressionResult({ algorithm, elapsedMs: decomp.elapsedMs });
      }
    }

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
          transfer(comp.out, [comp.out.buffer])
        );
        newDecompressionResult({ algorithm, elapsedMs: decomp.elapsedMs });
      }
    }

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
          transfer(comp.out, [comp.out.buffer])
        );
        newDecompressionResult({ algorithm, elapsedMs: decomp.elapsedMs });
      }
    }

    setCancelling(false);
    finish();
  };

  return (
    <>
      <FileInput onChange={onFile} />
      {state.kind === "running" ? (
        <div className="grid grid-cols-2">
          <p className="text-xl">Benchmarking {state.status}</p>
          <Button
            className="text-xl"
            disabled={isCancelling}
            onClick={() => setCancelling(true)}
          >
            {isCancelling ? "Cancelling ..." : "Cancel"}
          </Button>
        </div>
      ) : null}
      {state.kind === "running" || state.kind === "finished" ? (
        <ResultReport iterations={iterations} {...state} />
      ) : null}
    </>
  );
};

const formatBytes = (bytes: number) => {
  return `${formatFloat(bytes / 1000 / 1000)} mB`;
};

const payloadSizes = {
  native: [0, 0],
  lz4: [0, undefined],
  zstd: [0, undefined],
  miniz: [0, undefined],
  pako: [0, undefined],
  fflate: [0, undefined],
} as const;

const payloadSizesLookup = new Map(Object.entries(payloadSizes));

type ResultRow = {
  algorithm: string;
  payload: readonly [number | undefined, number | undefined];
  ratio: number;
  runs: [number[], number[]]
}

const resultRows = (bytes: number, rows: BenchmarkProfile[]) => {
  let currentAlgorithm = "";
  let [comps, decomps]: ResultRow["runs"] = [[], []];
  const results: ResultRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const mbs = bytes / 1000 / 1000 / (row.elapsedMs / 1000);
    if (row.algorithm !== currentAlgorithm && row.action === "compression") {
      const payload = payloadSizesLookup.get(row.algorithm) ?? [
        undefined,
        undefined,
      ];

      [comps, decomps] = [[], []];

      results.push({
        algorithm: row.algorithm,
        payload,
        ratio: bytes / row.size,
        runs: [comps, decomps],
      });
      currentAlgorithm = row.algorithm;
    }
    
    if (row.action === "decompression") {
      decomps.push(mbs);
    } else {
      comps.push(mbs);
    }
  }

  return results;
};

type ResultReportProps = {
  filename: string;
  bytes: number;
  results: BenchmarkProfile[];
  iterations: number;
};

const ResultReport = ({
  filename,
  bytes,
  results,
  iterations,
}: ResultReportProps) => {
  const rows = useMemo(() => resultRows(bytes, results), [bytes, results]);
  return (
    <table className="my-5 w-full table-fixed border border-slate-400 dark:border-slate-500">
      <thead>
        <tr>
          <th colSpan={10}>
            {filename} - ({formatBytes(bytes)})
          </th>
        </tr>
        <tr>
          <th className="text-left" rowSpan={2}>
            Name
          </th>
          <th rowSpan={2}>Ratio</th>
          <th colSpan={2}>Payload (kB)</th>
          <th colSpan={3}>Compression (mB/s)</th>
          <th colSpan={3}>Decompression (mB/s)</th>
        </tr>
        <tr>
          <th className="text-right">Read</th>
          <th className="text-right">Write</th>
          {[...Array(iterations)].map((_, i) => (
            <th key={`compression-${i}`} className="text-right">
              {i + 1}
            </th>
          ))}
          {[...Array(iterations)].map((_, i) => (
            <th key={`decompression-${i}`} className="text-right">
              {i + 1}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.algorithm}>
            <td>{row.algorithm}</td>
            <td className="text-right">{formatFloat(row.ratio)}</td>
            <td className="text-right">{row.payload[0] ?? "---"}</td>
            <td className="text-right">{row.payload[1] ?? "---"}</td>

            {[...Array(iterations)].map((_, i) => (
              <td key={`compression-${i}`} className="text-right">
                {row.runs[0][i] ? formatFloat(row.runs[0][i]) : ""}
              </td>
            ))}

            {[...Array(iterations)].map((_, i) => (
              <td key={`decompression-${i}`} className="text-right">
                {row.runs[1][i] ? formatFloat(row.runs[1][i]) : ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
