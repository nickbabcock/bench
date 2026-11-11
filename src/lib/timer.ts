/**
 * Clock granularity as a page or worker sees it. Kept free of DOM and
 * worker APIs so both the page and timerWorker.ts can use it.
 */
export type TimerProbe = {
  /** Smallest non-zero step observed in performance.now(), in ms. */
  minStepMs: number;
  /**
   * Median non-zero step, in ms: the typical granularity. Engines that add
   * jitter (Chrome without cross-origin isolation) make the minimum
   * optimistic, so this is the resolution an edition reports.
   */
  medianStepMs: number;
  /** Non-zero steps observed while spinning. */
  steps: number;
  crossOriginIsolated: boolean;
};

/** Spin for `spinMs` and record every non-zero step of the clock. */
export function probeTimer(spinMs = 20): TimerProbe {
  const steps: number[] = [];
  const start = performance.now();
  let last = start;
  while (last - start < spinMs) {
    const now = performance.now();
    if (now > last) {
      steps.push(now - last);
      last = now;
    }
  }
  steps.sort((a, b) => a - b);
  return {
    minStepMs: steps[0] ?? NaN,
    medianStepMs: steps[steps.length >> 1] ?? NaN,
    steps: steps.length,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
  };
}
