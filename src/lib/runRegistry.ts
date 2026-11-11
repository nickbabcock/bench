import { create } from "zustand";

export type Benchmark = "compression" | "allocation" | "memory64" | "build";

export const benchmarkNames: Record<Benchmark, string> = {
  compression: "Compression",
  allocation: "Allocation",
  memory64: "Memory64",
  build: "Build settings",
};

/**
 * One benchmark runs at a time, site-wide. Runs live in module stores, so
 * they keep going when you switch tabs; the tab shows a live lamp, and the
 * other benchmarks wait rather than compete for the CPU.
 */
export const useRunRegistry = create<{ active: Benchmark | null }>()(() => ({
  active: null,
}));

let unloadGuard: ((e: BeforeUnloadEvent) => void) | null = null;

export function claimRun(benchmark: Benchmark) {
  useRunRegistry.setState({ active: benchmark });
  if (typeof window !== "undefined" && !unloadGuard) {
    unloadGuard = (e) => e.preventDefault();
    window.addEventListener("beforeunload", unloadGuard);
  }
}

/**
 * When a run ends and focus was lost (its controls were disabled), move
 * keyboard focus to the Results heading so the outcome is one Tab away.
 */
export function focusResults() {
  if (typeof document === "undefined") {
    return;
  }
  const active = document.activeElement;
  // Cancel is about to unmount with the run, so focus on it counts as lost.
  if (!active || active === document.body || (active as HTMLButtonElement).disabled || active.matches("[data-cancel]")) {
    // <ResultsTarget> (src/components/release) renders it on every benchmark page.
    document.getElementById("results")?.focus({ preventScroll: true });
  }
}

export function releaseRun(benchmark: Benchmark) {
  if (useRunRegistry.getState().active === benchmark) {
    useRunRegistry.setState({ active: null });
  }
  if (unloadGuard) {
    window.removeEventListener("beforeunload", unloadGuard);
    unloadGuard = null;
  }
  focusResults();
}

export const useActiveRun = () => useRunRegistry((s) => s.active);
