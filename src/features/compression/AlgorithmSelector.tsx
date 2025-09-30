"use client";

import { useActions, useAlgorithms } from "./store";

const ALGORITHM_NAMES = {
  native: "Browser",
  lz4: "LZ4",
  zstd: "Zstd",
  miniz: "Miniz",
  pako: "Pako",
  fflate: "fflate",
  brotli: "Brotli",
  zune: "Zune",
  libdeflate: "libdeflate",
  zlibrs: "zlib-rs",
} as const;

export const AlgorithmSelector = () => {
  const algorithms = useAlgorithms();
  const { setAlgorithmEnabled } = useActions();

  const algorithmList = Object.entries(algorithms).map(([key, value]) => ({
    key: key as keyof typeof algorithms,
    name: ALGORITHM_NAMES[key as keyof typeof ALGORITHM_NAMES],
    enabled: value.enabled,
  }));

  const enabledCount = algorithmList.filter((alg) => alg.enabled).length;
  const totalCount = algorithmList.length;

  const toggleAll = () => {
    const allEnabled = enabledCount === totalCount;
    algorithmList.forEach((alg) => {
      setAlgorithmEnabled(alg.key, !allEnabled);
    });
  };

  return (
    <fieldset className="space-y-4">
      <legend className="sr-only">
        Select compression algorithms to benchmark
      </legend>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold" id="algorithm-selection-heading">
          Algorithm Selection
        </h3>
        <div className="flex items-center gap-4">
          <div
            className="text-sm text-gray-600 dark:text-gray-400"
            aria-live="polite"
            aria-atomic="true"
          >
            {enabledCount} of {totalCount} selected
          </div>
          <button
            onClick={toggleAll}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            aria-describedby="algorithm-selection-heading"
          >
            {enabledCount === totalCount ? "Deselect All" : "Select All"}
          </button>
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5"
        role="group"
        aria-labelledby="algorithm-selection-heading"
      >
        {algorithmList.map((alg) => (
          <label
            key={alg.key}
            className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-gray-200 bg-gray-50 p-3 transition-colors hover:bg-gray-100 has-[:checked]:border-blue-300 has-[:checked]:bg-blue-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:has-[:checked]:border-blue-600 dark:has-[:checked]:bg-blue-900/20"
          >
            <input
              type="checkbox"
              checked={alg.enabled}
              onChange={(e) => setAlgorithmEnabled(alg.key, e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:ring-offset-gray-800 dark:focus:ring-blue-600"
            />
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {alg.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};
