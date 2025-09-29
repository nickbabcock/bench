"use client";

import { Button } from "@/components/Button";
import { BenchmarkProfile } from "./types";
import { formatFloat } from "@/lib/format";

interface ResultsExportProps {
  filename: string;
  results: BenchmarkProfile[];
  bytes: number;
}

export const ResultsExport = ({
  filename,
  results,
  bytes,
}: ResultsExportProps) => {
  const exportToJSON = () => {
    const exportData = {
      filename,
      fileSizeBytes: bytes,
      timestamp: new Date().toISOString(),
      results: results.map((result) => ({
        algorithm: result.algorithm,
        action: result.action,
        elapsedMs: result.elapsedMs,
        ...(result.action === "compression" && {
          compressedSizeBytes: result.size,
          compressionRatio: formatFloat(bytes / result.size),
        }),
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `compression-benchmark-${filename.replace(/\.[^/.]+$/, "")}-${new Date().toISOString().split("T")[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportToCSV = () => {
    const csvHeader =
      "Algorithm,Action,Elapsed (ms),Compressed Size (bytes),Compression Ratio\n";

    const csvRows = results.map((result) => {
      const compressionData =
        result.action === "compression"
          ? `${result.size},${formatFloat(bytes / result.size)}`
          : ",";
      return `${result.algorithm},${result.action},${result.elapsedMs},${compressionData}`;
    });

    const csvContent = csvHeader + csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `compression-benchmark-${filename.replace(/\.[^/.]+$/, "")}-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex gap-2">
      <Button onClick={exportToJSON} variant="outline" size="sm">
        Export JSON
      </Button>
      <Button onClick={exportToCSV} variant="outline" size="sm">
        Export CSV
      </Button>
    </div>
  );
};
