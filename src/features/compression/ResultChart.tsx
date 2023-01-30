import { formatFloat } from "@/lib/format";
import { useEffect, useMemo, useRef } from "react";
import { Chart } from "chart.js/auto";
import { BenchmarkProfile, CompressionProfileData } from "./types";
import { useCompressionUiState } from "./store";
import { shallowEq } from "@/lib/eq";
import { useIsomorphicLayoutEffect } from "@/hooks";

function groupBy<T, K>(items: T[], fn: (arg0: T) => K): Map<K, T[]> {
  const result: Map<K, T[]> = new Map();
  for (const item of items) {
    const key = fn(item);
    const existing = result.get(key);
    result.set(key, [...(existing ?? []), item]);
  }
  return result;
}

const chartDatasets = (bytes: number, rows: BenchmarkProfile[]) => {
  // https://colorbrewer2.org/#type=qualitative&scheme=Set3&n=7
  const colors = {
    native: "#8dd3c7",
    lz4: "#ffffb3",
    zstd: "#bebada",
    miniz: "#fb8072",
    pako: "#80b1d3",
    fflate: "#fdb462",
    brotli: "#b3de69",
  };

  const colorMap = new Map(Object.entries(colors));

  let maxRatio = 1;
  for (const row of rows) {
    if (row.action === "compression") {
      maxRatio = Math.max(bytes / row.size, maxRatio);
    }
  }

  const algorithmFamily = (algo: string) => algo.split("-")[0];

  const families = groupBy(rows, (x) => algorithmFamily(x.algorithm));
  return [...families.entries()]
    .sort(([aFamily], [bFamily]) => aFamily.localeCompare(bFamily))
    .map(([family, familyGroup]) => {
      const groups = groupBy(familyGroup, (x) => x.algorithm);

      const data = [...groups.entries()].map(([algorithm, group]) => {
        const compressions = group.filter(
          (x): x is { action: "compression" } & CompressionProfileData =>
            x.action === "compression"
        );
        const totalCompMs = compressions.reduce(
          (acc, x) => acc + x.elapsedMs,
          0
        );
        const averageCompBpMs =
          bytes / (totalCompMs / compressions.length) || 0;
        const ratio = bytes / compressions[0].size || 1;

        const decompressions = group.filter(
          (x) => x.action === "decompression"
        );
        const totalDecompMs = decompressions.reduce(
          (acc, x) => acc + x.elapsedMs,
          0
        );
        const averageDecompBpMs =
          bytes / (totalDecompMs / decompressions.length) || 0;

        return {
          algorithm,
          ratio,
          x: averageCompBpMs / 1000,
          y: averageDecompBpMs / 1000,
          r: (ratio / maxRatio) * 20,
        };
      });

      return {
        label: family,
        data,
        borderColor: "#44403c",
        backgroundColor: colorMap.get(family) ?? "black",
      };
    });
};

type ResultChartProps = {
  filename: string;
  bytes: number;
  results: BenchmarkProfile[];
};

export const ResultChart = ({ filename, bytes, results }: ResultChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | undefined>(undefined);
  const actives = useCompressionUiState((state) => state.activeAlgorithms);

  const datasets = useMemo(
    () => chartDatasets(bytes, results),
    [bytes, results]
  );
  const dataSetsRef = useRef(datasets);
  useIsomorphicLayoutEffect(() => {
    dataSetsRef.current = datasets; 
  })

  useEffect(() => {
    const ref = canvasRef.current;
    if (ref === null) {
      return;
    }

    const canvas = ref;
    let mounted = true;
    async function runEffect() {
      const { Chart } = await import("chart.js/auto");

      if (!mounted) {
        return;
      }

      const chart = new Chart(canvas, {
        type: "bubble",
        data: {
          datasets: dataSetsRef.current,
        },
        options: {
          responsive: true,
          scales: {
            x: {
              title: {
                display: true,
                text: "Compression (MB/s)",
              },
              beginAtZero: true,
            },
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: "Decompression (MB/s)",
              },
            },
          },
          plugins: {
            tooltip: {
              intersect: true,
              external: (ctx) => {
                useCompressionUiState
                  .getState()
                  .actions.setActiveAlgorithms(
                    ctx.chart
                      .getActiveElements()
                      .map(
                        (x) =>
                          dataSetsRef.current[x.datasetIndex].data[x.index]
                            .algorithm
                      )
                  );
              },
              callbacks: {
                label: (x) => {
                  const data =
                    dataSetsRef.current[x.datasetIndex].data[x.dataIndex];
                  return `${data.algorithm} - ${formatFloat(data.ratio)}`;
                },
              },
            },
          },
        },
      });
      chartRef.current = chart;
    }

    runEffect();

    return () => {
      mounted = false;
      chartRef.current?.destroy();
      chartRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.data.datasets = datasets;
      chartRef.current.update();
    }
  }, [datasets]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const currents = chart
      .getActiveElements()
      .map((x) => dataSetsRef.current[x.datasetIndex].data[x.index].algorithm);

    if (shallowEq(currents, actives)) {
      return;
    }

    const activeElements = actives.map((x) => {
      for (let i = 0; i < dataSetsRef.current.length; i++) {
        const dataset = dataSetsRef.current[i];
        for (let j = 0; j < dataset.data.length; j++) {
          const datum = dataset.data[j];
          if (datum.algorithm === x) {
            return {
              datasetIndex: i,
              index: j,
            };
          }
        }
      }

      return {
        datasetIndex: 0,
        index: 0,
      };
    });

    chart.setActiveElements(activeElements);
    chart.tooltip?.setActiveElements(activeElements, { x: 0, y: 0 });
    chart.update();
  }, [actives]);

  return <canvas ref={canvasRef}></canvas>;
};
