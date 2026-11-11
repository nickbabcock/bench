/** The geometric mean of positive values (ratios): exp of the mean log. */
export const geomean = (xs: readonly number[]) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);

export function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * A sample's median with its observed min–max range. The range is not a
 * confidence interval: it is the extremes seen, and it widens with n.
 */
export type Summary = {
  median: number;
  min: number;
  max: number;
  /** Half the observed min–max range, relative to the median. */
  spread: number;
  n: number;
};

export function summarize(xs: readonly number[]): Summary {
  if (xs.length === 0) {
    return { median: NaN, min: NaN, max: NaN, spread: NaN, n: 0 };
  }
  const m = median(xs);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return { median: m, min, max, spread: (max - min) / 2 / m, n: xs.length };
}

/** Whether two samples' min–max ranges overlap: they can't be told apart. */
export const overlaps = (a: Summary, b: Summary) =>
  a.min <= b.max && b.min <= a.max;

/** Spread above this is too wide for a range overlap alone to tie (see `ties`). */
const NOISY_SPREAD = 0.1;

/**
 * Practical-significance floor. When the larger median is less than 3%
 * above the smaller (a ratio inside roughly 0.97 to 1.03), the two are
 * "about the same": never bolded, crowned, called faster or slower, and
 * tied in placings, even when their ranges separate. A claim needs both
 * separated min–max ranges and a ratio of at least 1 + PRACTICAL_FLOOR.
 */
export const PRACTICAL_FLOOR = 0.03;

/**
 * Whether a ratio between two medians (either way round) is under the
 * floor. Works on any positive ratio, e.g. wasm64 ÷ wasm32 or a speed-up.
 */
export const sameRatio = (r: number, floor = PRACTICAL_FLOOR) =>
  r > 0 && Number.isFinite(r) && Math.max(r, 1 / r) < 1 + floor;

/**
 * Whether two summaries' medians differ by less than the floor. Symmetric,
 * and sign-aware so negated summaries (ranked lower-is-better) work too.
 */
function practicallySame(a: Summary, b: Summary, floor = PRACTICAL_FLOOR): boolean {
  if (a.median === b.median) {
    return true;
  }
  return Math.sign(a.median) === Math.sign(b.median) && sameRatio(a.median / b.median, floor);
}

export type Placing = {
  /** Competition position; tied entries share the position of their group. */
  pos: number;
  tied: boolean;
};

const isNoisy = (s: Summary) => s.spread > NOISY_SPREAD;

/**
 * Whether two entries tie: practically the same, or (both not noisy) their
 * min–max ranges overlap.
 */
export const ties = (a: Summary, b: Summary, floor = PRACTICAL_FLOOR) =>
  practicallySame(a, b, floor) || (!isNoisy(a) && !isNoisy(b) && overlaps(a, b));

/**
 * Rank entries that are already sorted best-first. Entries tie when every
 * member of the group ties with every other member (see `ties`). A group
 * grows only while that holds, so ties can't chain across a wide span, and
 * positions never claim more precision than the measurements have. Pass
 * `floor: 0` for a metric where any difference is real (an exact ratio).
 */
export function placings(sorted: readonly Summary[], { floor = PRACTICAL_FLOOR }: { floor?: number } = {}): Placing[] {
  const out: Placing[] = [];
  let head = 0;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    let joins = i > 0;
    for (let j = head; joins && j < i; j++) {
      joins = ties(sorted[j], s, floor);
    }
    if (!joins) {
      head = i;
    }
    out.push({ pos: head + 1, tied: false });
  }
  for (let i = 0; i < out.length; i++) {
    out[i].tied = out.some((o, j) => j !== i && o.pos === out[i].pos);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Paired effects: the site's one claim rule.
//
// Where two builds run in the same round (Build settings' variants, wasm64
// against wasm32), each round gives one ratio A/B, and drift that hits both
// alike cancels. The effect is the median of those ratios, with a
// distribution-free confidence interval from order statistics. A claim
// needs both a practically large median (|median − 1| > 3%) and a CI that
// excludes 1. The observed min–max stays for faint whiskers and tables; it
// never decides a claim.
// ---------------------------------------------------------------------------

/** The coverage the median CI aims for (it is at least this, never less). */
const CI_LEVEL = 0.95;

/** P(X ≤ k) for X ~ Binomial(n, 1/2), exactly. */
export function binomialCdfHalf(k: number, n: number): number {
  if (k < 0) {
    return 0;
  }
  if (k >= n) {
    return 1;
  }
  // Sum C(n, i) / 2^n term by term; each term from the last avoids overflow.
  let term = 2 ** -n;
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= (n - i + 1) / i;
    sum += term;
  }
  return Math.min(1, sum);
}

/**
 * A confidence interval for the median from order statistics: [x(k), x(n−k+1)]
 * of the sorted sample (1-based), with k the largest rank whose two tails
 * each hold at most (1 − level)/2 of a Binomial(n, ½). It assumes only
 * independent draws from one continuous distribution: no normality.
 *
 * `coverage` is the exact coverage, 1 − 2·P(B ≤ k − 1), at least `level`.
 * At n = 15 it is x(4)–x(12) with 96.5% coverage; at n = 10, x(2)–x(9)
 * (97.9%); at n = 6, the min–max (96.9%). Below 6 even the min–max covers
 * less than 95%, so there is no interval and this returns undefined.
 */
export type MedianCI = { lo: number; hi: number; k: number; coverage: number };

export function medianCI(xs: readonly number[], level = CI_LEVEL): MedianCI | undefined {
  const n = xs.length;
  const tail = (1 - level) / 2;
  let k = 0;
  while (k + 1 <= n / 2 && binomialCdfHalf(k, n) <= tail) {
    k++;
  }
  if (k === 0 || xs.some((x) => !Number.isFinite(x))) {
    return undefined;
  }
  const sorted = [...xs].sort((a, b) => a - b);
  return { lo: sorted[k - 1], hi: sorted[n - k], k, coverage: 1 - 2 * binomialCdfHalf(k - 1, n) };
}

/** Rounds below this have no 95% median CI, so they make no claim. */
export const MIN_PAIRED_ROUNDS = 6;

/**
 * Ratios are time ratios, subject ÷ reference: below 1 the subject took
 * less time ("faster"). "same": measured, but under the threshold or with a
 * CI that includes 1. "insufficient": too few rounds for a CI.
 */
export type PairedClaim = "faster" | "slower" | "same" | "insufficient";

export type PairedEffect = {
  median: number;
  /** About-95% CI of the median; undefined below MIN_PAIRED_ROUNDS. */
  ci?: MedianCI;
  /** Observed extremes: whiskers and tables only, never the claim test. */
  min: number;
  max: number;
  n: number;
  claim: PairedClaim;
};

/** Whether a paired claim says something (faster or slower). */
export const isPairedClaim = (c: PairedClaim): c is "faster" | "slower" => c === "faster" || c === "slower";

/**
 * The claim rule on per-round ratios: a claim iff |median − 1| > threshold
 * (3%, a reporting policy, not noise) AND the median CI excludes 1.
 */
export function pairedEffect(ratios: readonly number[], threshold = PRACTICAL_FLOOR): PairedEffect {
  const xs = ratios.filter((r) => Number.isFinite(r) && r > 0);
  if (xs.length === 0) {
    return { median: NaN, min: NaN, max: NaN, n: 0, claim: "insufficient" };
  }
  const m = median(xs);
  const ci = medianCI(xs);
  const base = { median: m, ci, min: Math.min(...xs), max: Math.max(...xs), n: xs.length };
  if (!ci) {
    return { ...base, claim: "insufficient" };
  }
  const large = Math.abs(m - 1) > threshold;
  const excludesOne = ci.hi < 1 || ci.lo > 1;
  return { ...base, claim: large && excludesOne ? (m < 1 ? "faster" : "slower") : "same" };
}

/** Effects under this distance from 1 (but claimed) are "small": 3–5% sits close to the instance-level bias A/A controls show. */
const SMALL_EFFECT = 0.05;

/** Whether an effect is small: |median − 1| < 5%. Pass a ratio or a PairedEffect. Pages word claimed small effects as "a small …". */
export const isSmall = (effect: number | Pick<PairedEffect, "median">) => {
  const m = typeof effect === "number" ? effect : effect.median;
  return Number.isFinite(m) && Math.abs(m - 1) < SMALL_EFFECT;
};

/** Per-round ratios a[i] / b[i] of two paired sample lists (same rounds). */
export function pairedRatios(a: readonly number[], b: readonly number[]): number[] {
  const n = Math.min(a.length, b.length);
  return Array.from({ length: n }, (_, i) => a[i] / b[i]);
}
