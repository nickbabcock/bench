import { pct } from "@/lib/findings";

/**
 * Scales and ticks for the hand-built SVG figures. A scale maps a data
 * value to a pixel position along [r0, r1] and carries its tick values.
 */
export type AxisKind = "log" | "linear";

export type Scale = {
  kind: AxisKind;
  domain: readonly [number, number];
  range: readonly [number, number];
  ticks: number[];
  (v: number): number;
  invert: (px: number) => number;
};

function make(kind: AxisKind, d0: number, d1: number, r0: number, r1: number, ticks: number[]): Scale {
  const f = kind === "log" ? Math.log : (v: number) => v;
  const g = kind === "log" ? Math.exp : (v: number) => v;
  const a = f(d0);
  const b = f(d1);
  const k = (r1 - r0) / (b - a || 1);
  const s = ((v: number) => r0 + (f(v) - a) * k) as Scale;
  s.kind = kind;
  s.domain = [d0, d1];
  s.range = [r0, r1];
  s.ticks = ticks;
  s.invert = (px: number) => g(a + (px - r0) / k);
  return s;
}

/** Whether tick labels of the given pixel widths, centred on `at`, sit apart by `gap`. */
const spaced = (at: number[], widths: number[], gap: number) =>
  at.every((x, i) => i === 0 || Math.abs(x - at[i - 1]) >= (widths[i] + widths[i - 1]) / 2 + gap);

export type TickFit = {
  /** Pixel width of a tick label. */
  measure: (v: number) => number;
  /** Minimum space between neighbouring labels, px (default 10). */
  gap?: number;
};

/** Whether `ticks` on `s` fit: labels apart by `gap`. */
const fitsOn = (s: Scale, ticks: number[], fit: TickFit) => spaced(ticks.map(s), ticks.map(fit.measure), fit.gap ?? 10);

const LOG_SETS = [[1, 2, 3, 5], [1, 2, 5], [1, 3], [1]];

/**
 * Log axis with 1-2-3-5 ticks. The domain runs from a 1-2-3-5 tick at or
 * below the smallest value to one at or above the largest, both labelled,
 * so every mark sits inside a labelled span. Between them, the densest of
 * 1-2-3-5, 1-2-5, 1-3 or 1 whose labels fit; an inner tick that crowds an
 * end gives way to it. A narrow spread is padded so marks don't crowd.
 */
export function logScale(lo: number, hi: number, r0: number, r1: number, fit: TickFit): Scale {
  if (!(lo > 0) || !(hi > 0)) {
    return make("log", 1, 10, r0, r1, [1, 10]);
  }
  // A narrow spread (a ratio near 1, times within 3×) gets round linear
  // steps on the log axis instead: 0.9, 1.0, 1.1 rather than 0.5, 1, 2.
  if (hi / lo < 3) {
    const a = lo / 1.03;
    const b = hi * 1.03;
    const base = 10 ** Math.floor(Math.log10((b - a) / 6));
    for (let e = 0; e < 3; e++) {
      for (const m of LINEAR_STEPS) {
        const step = m * base * 10 ** e;
        const d0 = Math.floor(a / step + 1e-9) * step;
        const d1 = Math.ceil(b / step - 1e-9) * step;
        const n = Math.round((d1 - d0) / step);
        if (d0 <= 0 || n > 6) {
          continue;
        }
        const ticks = Array.from({ length: n + 1 }, (_, i) => +(d0 + i * step).toPrecision(12));
        const s = make("log", d0, d1, r0, r1, ticks);
        if (fitsOn(s, ticks, fit)) {
          return s;
        }
      }
    }
  }
  const pad = hi / lo >= 4 ? 1.02 : Math.sqrt(4 / Math.max(hi / lo, 1.01));
  const a = lo / pad;
  const b = hi * pad;
  const gen = (set: number[]) => {
    const all: number[] = [];
    for (let e = Math.floor(Math.log10(a)) - 1; e <= Math.ceil(Math.log10(b)) + 1; e++) {
      for (const m of set) {
        all.push(+(m * 10 ** e).toPrecision(6));
      }
    }
    return all.sort((p, q) => p - q);
  };
  const dense = gen(LOG_SETS[0]);
  const x0 = [...dense].reverse().find((v) => v <= a) ?? dense[0];
  const x1 = dense.find((v) => v >= b) ?? dense[dense.length - 1];
  const s = make("log", x0, x1, r0, r1, []);
  const fits = (ticks: number[]) => fitsOn(s, ticks, fit);
  let fallback = [x0, x1];
  for (const set of LOG_SETS) {
    let ticks = [x0, ...gen(set).filter((v) => v > x0 * 1.001 && v < x1 * 0.999), x1];
    while (ticks.length > 2 && !fits(ticks)) {
      if (!fits(ticks.slice(0, 2))) {
        ticks = [ticks[0], ...ticks.slice(2)];
      } else if (!fits(ticks.slice(-2))) {
        ticks = [...ticks.slice(0, -2), ticks[ticks.length - 1]];
      } else {
        break;
      }
    }
    if (fits(ticks)) {
      if (ticks.length >= 3) {
        s.ticks = ticks;
        return s;
      }
      fallback = ticks;
    }
  }
  s.ticks = fallback;
  return s;
}

const LINEAR_STEPS = [1, 2, 2.5, 5];

/**
 * Linear axis on round steps (1, 2, 2.5, 5 × 10^k): the finest step whose
 * labels fit and that gives at most `maxTicks` ticks. The domain snaps out
 * to whole steps. `zero` keeps 0 in the domain (magnitudes); `include`
 * adds values that must be inside it (a reference line).
 */
export function linearScale(
  lo: number,
  hi: number,
  r0: number,
  r1: number,
  fit: TickFit & { zero?: boolean; include?: number[]; maxTicks?: number },
): Scale {
  const vals = [lo, hi, ...(fit.include ?? []), ...(fit.zero ? [0] : [])].filter(Number.isFinite);
  let a = Math.min(...vals);
  let b = Math.max(...vals);
  if (a === b) {
    a -= Math.abs(a) * 0.1 || 1;
    b += Math.abs(b) * 0.1 || 1;
  }
  const span = b - a;
  const maxTicks = fit.maxTicks ?? 8;
  const base = 10 ** Math.floor(Math.log10(span / maxTicks));
  for (let e = 0; e < 4; e++) {
    for (const m of LINEAR_STEPS) {
      const step = m * base * 10 ** e;
      const d0 = Math.floor(a / step + 1e-9) * step;
      const d1 = Math.ceil(b / step - 1e-9) * step;
      const n = Math.round((d1 - d0) / step);
      if (n > maxTicks) {
        continue;
      }
      const ticks = Array.from({ length: n + 1 }, (_, i) => +(d0 + i * step).toPrecision(12));
      const s = make("linear", d0, d1, r0, r1, ticks);
      if (fitsOn(s, ticks, fit)) {
        return s;
      }
    }
  }
  return make("linear", a, b, r0, r1, [a, b]);
}

/**
 * Log-ratio axis for paired effects (1 = no change), ticked in round
 * percentages of time either side: −50, −30, −20, −10, −5, −3, −2, −1%,
 * 0, +1 … +200%, at 1 − p and 1 + p. A wide range gets −90, −75, −50%,
 * 0, +100, +300, +900% (the site's one convention: a time
 * ratio r is |r − 1| less or more time). The domain covers [lo, hi], the
 * threshold, and at least ±5%, symmetric in log terms.
 */
export function ratioScale(lo: number, hi: number, r0: number, r1: number, fit: TickFit & { threshold?: number }): Scale {
  const t = fit.threshold ?? 0.03;
  const reach = Math.max(Math.abs(Math.log(lo)), Math.abs(Math.log(hi)), -Math.log(1 - t) * 1.6, -Math.log(0.95)) * 1.08;
  const s = make("log", Math.exp(-reach), Math.exp(reach), r0, r1, []);
  const pcts = [1, 2, 3, 5, 10, 20, 30, 50, 100, 200];
  const inside = (r: number) => Math.abs(Math.log(r)) <= reach;
  // Densest round-percentage set whose labels fit: [less, more] in percent.
  const sets: [number[], number[]][] = [pcts, [1, 2, 5, 10, 20, 50, 100, 200], [2, 5, 10, 20, 50, 100], [5, 10, 50, 100], [10, 100], [20, 100]].map((set) => [set, set]);
  // A wide range (one operation 6× as long as another): about 2× a step.
  sets.push([[50, 75, 90], [100, 300, 900]], [[50, 90], [100, 900]], [[50], [100]], [[50], [50]]);
  for (const [less, more] of sets) {
    const below = less.filter((p) => p < 100 && inside(1 - p / 100)).map((p) => 1 - p / 100);
    const above = more.filter((p) => inside(1 + p / 100)).map((p) => 1 + p / 100);
    const ticks = [...below.reverse(), 1, ...above];
    if (ticks.length > 1 && spaced(ticks.map(s), ticks.map(fit.measure), fit.gap ?? 8)) {
      s.ticks = ticks;
      return s;
    }
  }
  s.ticks = [1];
  return s;
}

/**
 * A ratio axis tick: the signed change, |r − 1| as a percentage. 0.9 →
 * "−10%", 1.1 → "+10%", 1 → "0%". For time ratios the axis ends carry
 * "less time" and "more time".
 */
export function ratioTick(r: number): string {
  if (Math.abs(r - 1) < 1e-9) {
    return "0%";
  }
  const p = Math.abs(r - 1) * 100;
  return `${r < 1 ? "\u2212" : "+"}${p >= 10 ? Math.round(p) : +p.toFixed(1)}%`;
}

/**
 * A time ratio in words, as src/lib/findings.ts `timeChange` words it but
 * with one decimal always, for value columns and tooltips: 0.95 → "5.0%
 * less time", 1.04 → "4.0% more time", 1 → "no change". Whether
 * the difference is claimed is the caller's decision (src/lib/stats.ts).
 * For speed wording ("faster", "slower") use findings.ts `speedChange`,
 * which converts properly.
 */
export function ratioPercent(r: number): string {
  if (!Number.isFinite(r) || r <= 0) {
    return "—";
  }
  if (Math.abs(r - 1) < 5e-4) {
    return "no change";
  }
  // Value columns align: always one decimal ("4.0% less time").
  return r <= 1 ? `${pct(1 - r, true)} less time` : `${pct(r - 1, true)} more time`;
}
