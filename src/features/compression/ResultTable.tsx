import { formatFloat } from "@/lib/format";
import clsx from "clsx";
import { useMemo } from "react";
import { BenchmarkProfile } from "./types";
import { useCompressionUiState } from "./store";

const formatBytes = (bytes: number) => {
  return `${formatFloat(bytes / 1000 / 1000)} MB`;
};

const payloadSizes = {
  native: [0, 0],
  lz4: [13.94, 13.94],
  zstd: [48.1, 136],
  miniz: [25.17, 25.17],
  pako: [15.22, 15.22],
  fflate: [12.37, 12.37],
  brotli: [137.77, 681.03],
} as const;

const payloadSizesLookup = new Map(Object.entries(payloadSizes));

type ResultRow = {
  algorithm: string;
  payload: readonly [number | undefined, number | undefined];
  ratio: number;
  runs: [number[], number[]];
};

const resultRows = (bytes: number, rows: BenchmarkProfile[]) => {
  let currentAlgorithm = "";
  let [comps, decomps]: ResultRow["runs"] = [[], []];
  const results: ResultRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const mbs = bytes / 1000 / 1000 / (row.elapsedMs / 1000);
    if (row.algorithm !== currentAlgorithm && row.action === "compression") {
      const payload = payloadSizesLookup.get(row.algorithm.split("-")[0]) ?? [
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

type ResultTableProps = {
  filename: string;
  bytes: number;
  results: BenchmarkProfile[];
  iterations: number;
};

export const ResultTable = ({
  filename,
  bytes,
  results,
  iterations,
}: ResultTableProps) => {
  const rows = useMemo(() => resultRows(bytes, results), [bytes, results]);
  const actives = new Set(
    useCompressionUiState((state) => state.activeAlgorithms)
  );
  const { setActiveAlgorithms } = useCompressionUiState(
    (state) => state.actions
  );
  return (
    <table className="mx-auto w-[800px] table-fixed border-collapse">
      <thead>
        <tr>
          <th
            className="p-4 text-lg text-slate-600 dark:text-slate-200"
            colSpan={10}
          >
            {filename} - ({formatBytes(bytes)})
          </th>
        </tr>
        <tr>
          <th
            className="border-b p-4 pl-4 pt-0 pb-3 text-left text-slate-600 dark:border-slate-600 dark:text-slate-200"
            rowSpan={2}
          >
            Name
          </th>
          <th
            className="border-b p-4 pl-4 pt-0 pb-3 text-slate-600 dark:border-slate-600 dark:text-slate-200"
            rowSpan={2}
          >
            Ratio
          </th>
          <th className="text-slate-600 dark:text-slate-200" colSpan={2}>
            Lib Size (gzip kB)
          </th>
          <th className="text-slate-600 dark:text-slate-200" colSpan={3}>
            Compression (MB/s)
          </th>
          <th className="text-slate-600 dark:text-slate-200" colSpan={3}>
            Decompression (MB/s)
          </th>
        </tr>
        <tr>
          <th className="border-b p-4 pl-4 pt-0 pb-3 text-right text-slate-600 dark:border-slate-600 dark:text-slate-200">
            Read
          </th>
          <th className="border-b p-4 pl-4 pt-0 pb-3 text-right text-slate-600 dark:border-slate-600 dark:text-slate-200">
            Write
          </th>
          {[...Array(iterations)].map((_, i) => (
            <th
              key={`compression-${i}`}
              className="border-b p-4 pl-4 pt-0 pb-3 text-right text-slate-600 dark:border-slate-600 dark:text-slate-200"
            >
              {i + 1}
            </th>
          ))}
          {[...Array(iterations)].map((_, i) => (
            <th
              key={`decompression-${i}`}
              className="border-b p-4 pl-4 pt-0 pb-3 text-right text-slate-600 dark:border-slate-600 dark:text-slate-200"
            >
              {i + 1}
            </th>
          ))}
        </tr>
      </thead>
      <tbody onPointerLeave={() => setActiveAlgorithms([])}>
        {rows.map((row) => (
          <tr
            className={clsx(
              "transition-colors duration-200 hover:bg-slate-200 dark:hover:bg-slate-700",
              { "bg-slate-200 dark:bg-slate-700": actives.has(row.algorithm) }
            )}
            onPointerEnter={() => setActiveAlgorithms([row.algorithm])}
            key={row.algorithm}
          >
            <td className="pl-2">{row.algorithm}</td>
            <td className="text-right">{formatFloat(row.ratio)}</td>
            <td className="text-right">
              {row.payload[0] ? formatFloat(row.payload[0]) : "---"}
            </td>
            <td className="text-right">
              {row.payload[1] ? formatFloat(row.payload[1]) : "---"}
            </td>

            {[...Array(iterations)].map((_, i) => (
              <td key={`compression-${i}`} className="text-right">
                {row.runs[0][i] ? formatFloat(row.runs[0][i]) : ""}
              </td>
            ))}

            {[...Array(iterations)].map((_, i) => (
              <td
                key={`decompression-${i}`}
                className={clsx("text-right", { "pr-2": i == iterations - 1 })}
              >
                {row.runs[1][i] ? formatFloat(row.runs[1][i]) : ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
