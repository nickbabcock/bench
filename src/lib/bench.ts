/**
 * Shared measurement policy for every benchmark on the site.
 *
 * Browsers coarsen `performance.now()` (to 100µs in Chrome workers, and as
 * coarse as 1ms elsewhere), so a single fast call can't be timed honestly.
 * Each timed sample instead runs a calibrated batch of repetitions that lasts
 * at least MIN_SAMPLE_MS, and reports the batch time divided by its size.
 */
export const MIN_SAMPLE_MS = 50;
export const MAX_REPETITIONS = 1_000_000;
/** Untimed warm-up per subject, so engines can tier code up first. */
export const MIN_WARMUP_MS = 250;
export const MIN_WARMUP_ROUNDS = 2;
export const MAX_WARMUP_ROUNDS = 20;

/** Reject when `signal` aborts, even if `promise` never settles. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Grow a repetition count until one batch of `time(repetitions)` lasts at
 * least MIN_SAMPLE_MS. Cold first batches are slow, so a single measurement
 * would underestimate the count; this keeps measuring until a batch clears
 * the bar. Every batch also serves as warm-up.
 */
export async function calibrate(
  time: (repetitions: number) => Promise<number>,
): Promise<{ repetitions: number; firstMs: number }> {
  let repetitions = 1;
  let firstMs = NaN;
  for (;;) {
    const elapsed = await time(repetitions);
    if (Number.isNaN(firstMs)) {
      firstMs = elapsed;
    }
    if (elapsed >= MIN_SAMPLE_MS || repetitions >= MAX_REPETITIONS) {
      return { repetitions, firstMs };
    }
    const growth = Math.ceil(MIN_SAMPLE_MS / Math.max(elapsed, 0.1));
    repetitions = Math.min(
      MAX_REPETITIONS,
      repetitions * Math.min(Math.max(growth, 2), 10),
    );
  }
}

/**
 * Run untimed batches until both the round and time minimums are met.
 * `time` gets the round index and returns the round's elapsed ms.
 */
export async function warmUp(time: (round: number) => Promise<number>, minMs: number = MIN_WARMUP_MS) {
  let total = 0;
  for (
    let round = 0;
    round < MAX_WARMUP_ROUNDS &&
    (round < MIN_WARMUP_ROUNDS || total < minMs);
    round++
  ) {
    total += await time(round);
  }
}

/** `items` rotated left by `offset`, so each round starts somewhere new. */
export function rotate<T>(items: readonly T[], offset: number): T[] {
  if (items.length === 0) {
    return [];
  }
  const k = offset % items.length;
  return [...items.slice(k), ...items.slice(0, k)];
}
