import { create } from "zustand";
import { families, type Family, familyInfo } from "./codecs";

interface CompressionUiState {
  /** Libraries the next run measures. */
  enabled: Record<Family, boolean>;
  actions: {
    setEnabled: (family: Family, enabled: boolean) => void;
    /** Every library on (opt-in variants stay off), or every library off. */
    setAll: (enabled: boolean) => void;
  };
}

const allFamilies = (value: boolean) =>
  Object.fromEntries(families.map((f) => [f, value && !familyInfo[f].optIn])) as Record<Family, boolean>;

export const useCompressionUi = create<CompressionUiState>()((set) => ({
  enabled: allFamilies(true),
  actions: {
    setEnabled: (family, enabled) => set((s) => ({ enabled: { ...s.enabled, [family]: enabled } })),
    setAll: (enabled) => set({ enabled: allFamilies(enabled) }),
  },
}));

export const useEnabled = () => useCompressionUi((s) => s.enabled);
export const useUiActions = () => useCompressionUi((s) => s.actions);
