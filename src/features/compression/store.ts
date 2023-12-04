import { shallowEq } from "@/lib/eq";
import { create } from "zustand";

interface Algorithm {
  enabled: boolean;
}

interface CompressionUiState {
  algorithms: {
    native: Algorithm;
    lz4: Algorithm;
    zstd: Algorithm;
    miniz: Algorithm;
    pako: Algorithm;
    fflate: Algorithm;
    brotli: Algorithm;
    zune: Algorithm;
    libdeflate: Algorithm;
  };
  activeAlgorithms: string[];
  actions: {
    setAlgorithmEnabled: (
      algorithm: keyof CompressionUiState["algorithms"],
      enabled: boolean,
    ) => void;
    setActiveAlgorithms: (algorithms: string[]) => void;
  };
}

export const useCompressionUiState = create<CompressionUiState>()(
  (set, get) => ({
    algorithms: {
      native: { enabled: true },
      lz4: { enabled: true },
      zstd: { enabled: true },
      miniz: { enabled: true },
      pako: { enabled: true },
      fflate: { enabled: true },
      brotli: { enabled: true },
      zune: { enabled: true },
      libdeflate: { enabled: true },
    },
    activeAlgorithms: [],
    actions: {
      setAlgorithmEnabled: (
        algorithm: keyof CompressionUiState["algorithms"],
        enabled: boolean,
      ) => {
        set((x) => ({
          algorithms: {
            ...x.algorithms,
            [algorithm]: {
              ...x.algorithms[algorithm],
              enabled,
            },
          },
        }));
      },
      setActiveAlgorithms: (algorithms: string[]) => {
        if (!shallowEq(algorithms, get().activeAlgorithms)) {
          set(() => ({ activeAlgorithms: algorithms }));
        }
      },
    },
  }),
);

export const useAlgorithms = () => useCompressionUiState((x) => x.algorithms);
export const useActions = () => useCompressionUiState((x) => x.actions);
export const useActives = () =>
  useCompressionUiState((x) => x.activeAlgorithms);
