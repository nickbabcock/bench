import { shallowEq } from "@/lib/eq";
import { create } from "zustand";

interface CompressionUiState {
  activeAlgorithms: string[];
  actions: {
    setActiveAlgorithms: (algorithms: string[]) => void;
  };
}

export const useCompressionUiState = create<CompressionUiState>()(
  (set, get) => ({
    activeAlgorithms: [],
    actions: {
      setActiveAlgorithms: (algorithms: string[]) => {
        if (!shallowEq(algorithms, get().activeAlgorithms)) {
          set(() => ({ activeAlgorithms: algorithms }));
        }
      },
    },
  }),
);
