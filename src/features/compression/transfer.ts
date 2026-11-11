/**
 * Time until the data is usable: one file sent over a network at a steady
 * bandwidth, from quantities measured in the browser.
 *
 * - Download a pre-compressed file: compressed bytes ÷ bandwidth, then
 *   decompress.
 * - Upload from the browser: compress, then compressed bytes ÷ bandwidth.
 * - Uncompressed: original bytes ÷ bandwidth.
 *
 * Bandwidth is in Mbps, 10⁶ bits per second. Latency is ignored, and
 * transfer and (de)compression are not overlapped (streaming would overlap
 * them). Server-side compression is not modelled: servers compress
 * natively, which this page doesn't measure.
 *
 * Every configuration is a line t(B) = fixed + bits ÷ B, so the best
 * choice at each bandwidth (the lower envelope) and the crossovers between
 * choices are exact.
 */
import { median, sameRatio } from "@/lib/stats";
import type { Row } from "./results";

export type Scenario = "download" | "upload";

/** The bandwidths the figures span, Mbps. */
export const BANDWIDTH = { lo: 1, hi: 1000 } as const;

export const UNCOMPRESSED = "uncompressed";

/** One configuration's time per file against bandwidth. */
export type Line = {
  /** The configuration's id, or UNCOMPRESSED. */
  id: string;
  label: string;
  /** Time that doesn't depend on bandwidth, ms: the median decompress (download) or compress (upload) time. */
  fixedMs: number;
  /** Bytes sent. */
  bytes: number;
};

/** Total time per file at `mbps`, ms. */
export const timeAt = (l: Line, mbps: number) => l.fixedMs + (l.bytes * 8) / (mbps * 1000);

/**
 * Each configuration's line for a scenario, plus Uncompressed. A
 * configuration needs its compressed size, a round trip that held, and at
 * least one sample of the operation the scenario times; a decode-only
 * library (zune-inflate) has no upload line.
 */
export function transferLines(rows: readonly Row[], scenario: Scenario): Line[] {
  const lines = rows.flatMap((r) => {
    const ms = scenario === "download" ? r.decodeMs : r.encodeMs;
    if (r.roundTrip === false || r.size === undefined || ms.length === 0 || (scenario === "upload" && r.decodeOnly)) {
      return [];
    }
    return [{ id: r.id, label: r.label, fixedMs: median(ms), bytes: r.size }];
  });
  const bytes = rows[0]?.bytes;
  return lines.length && bytes ? [...lines, { id: UNCOMPRESSED, label: "Uncompressed", fixedMs: 0, bytes }] : lines;
}

/**
 * Lines sorted by time at `mbps`, fastest first. Ties go to the line that
 * wins just above `mbps`: less fixed time.
 */
export const rankAt = (lines: readonly Line[], mbps: number) =>
  lines.map((line) => ({ line, ms: timeAt(line, mbps) })).sort((a, b) => a.ms - b.ms || a.line.fixedMs - b.line.fixedMs);

/** The bandwidth (Mbps) where two lines take the same time, if they cross at a positive bandwidth. */
export function crossing(a: Line, b: Line): number | undefined {
  const dBits = (a.bytes - b.bytes) * 8;
  const dFixed = b.fixedMs - a.fixedMs;
  if (dBits === 0 || dFixed === 0 || Math.sign(dBits) !== Math.sign(dFixed)) {
    return undefined;
  }
  // a.fixed + a.bits/(1000B) = b.fixed + b.bits/(1000B)  ⇒  B = Δbits ÷ (1000 · Δfixed)
  return dBits / (1000 * dFixed);
}

/** One stretch of the lower envelope: the best line from `from` to `to` Mbps. */
export type Segment = { line: Line; from: number; to: number };

/**
 * The lower envelope over [lo, hi] Mbps: the fastest line at each
 * bandwidth, exactly. Walking up in bandwidth, the current line gives way
 * to the first line that crosses it from above: more bytes but less fixed
 * time, which counts for more as bandwidth rises. Consecutive segments
 * meet at a crossover.
 */
export function envelope(lines: readonly Line[], lo: number = BANDWIDTH.lo, hi: number = BANDWIDTH.hi): Segment[] {
  if (lines.length === 0) {
    return [];
  }
  const out: Segment[] = [];
  // At `lo` itself, of the lines tied fastest (within rounding), the one that wins just to the right: least fixed time.
  const first = rankAt(lines, lo);
  let cur = first.filter((x) => x.ms <= first[0].ms * (1 + 1e-12)).sort((a, b) => a.line.fixedMs - b.line.fixedMs)[0].line;
  let at = lo;
  for (let guard = 0; guard <= lines.length; guard++) {
    let next: { line: Line; b: number } | undefined;
    for (const l of lines) {
      if (l === cur || l.bytes <= cur.bytes || l.fixedMs >= cur.fixedMs) {
        continue;
      }
      const b = crossing(cur, l)!;
      // Several crossing at once: past it, the least fixed time is fastest.
      if (b > at * (1 + 1e-12) && (!next || b < next.b || (b === next.b && l.fixedMs < next.line.fixedMs))) {
        next = { line: l, b };
      }
    }
    if (!next || next.b >= hi) {
      out.push({ line: cur, from: at, to: hi });
      return out;
    }
    out.push({ line: cur, from: at, to: next.b });
    cur = next.line;
    at = next.b;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Claims: who wins where, in every capture
// ---------------------------------------------------------------------------

/** Log-spaced bandwidths, 40 per decade, from lo to hi inclusive. */
export const GRID: readonly number[] = (() => {
  const n = Math.round(Math.log10(BANDWIDTH.hi / BANDWIDTH.lo) * 40);
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? BANDWIDTH.hi : BANDWIDTH.lo * 10 ** (i / 40)));
})();

/**
 * A stretch of bandwidth with its verdict. `winner` is set where one
 * configuration is fastest and the runner-up takes more than 3% longer
 * (medians), with the same winner, in every capture; otherwise the
 * leaders are about the same, and `near` lists every configuration within
 * 3% of the fastest somewhere in the stretch, in some capture.
 */
export type Band = {
  /** Exact edges, Mbps: where the verdict changes. */
  from: number;
  to: number;
  /**
   * The edges as stated (`≈20 Mbps`): nice values (`roundNice`), `null` at
   * the ends of the range. A claimed band's stated edges lie inside its
   * exact edges, where the gate holds in every capture, so everything
   * between them is claimed; an about-the-same band takes its neighbours'
   * stated edges.
   */
  lo: number | null;
  hi: number | null;
  winner?: string;
  near: string[];
};

/**
 * Bands of one setting from its captures (the first is the one shown),
 * strictly by the gate: a band names a winner only over bandwidths where,
 * in every capture, it is fastest and the runner-up takes more than 3%
 * longer. Its exact edges are found by bisection between grid points;
 * nothing is widened or merged. Everything else is about the same.
 *
 * A stated edge rounds to the nearest nice value when that lies inside the
 * exact band and the gate holds there in every capture; otherwise it
 * rounds inward. A band too narrow to state after rounding is left about
 * the same. An about-the-same stretch whose stated edges meet (both
 * neighbours state the same value, or both are the range's ends) has
 * nothing to state, so it is not a band of its own.
 */
export function bandsOf(captures: readonly (readonly Line[])[], grid: readonly number[] = GRID): Band[] {
  if (captures.length === 0 || captures.some((c) => c.length < 2)) {
    return [];
  }
  const [lo, hi] = [grid[0], grid.at(-1)!];
  /** The winner at `b` if the gate holds there, else undefined. */
  const clearAt = (b: number) => {
    const ws = captures.map((lines) => {
      const [a, n] = rankAt(lines, b);
      return n && !sameRatio(n.ms / a.ms) ? a.line.id : undefined;
    });
    return ws[0] !== undefined && ws.every((w) => w === ws[0]) ? ws[0] : undefined;
  };
  /** Where `clearAt(·) === id` flips between a (holds) and b (doesn't), by bisection on a log scale. */
  const edge = (id: string, inside: number, outside: number) => {
    let [a, b] = [inside, outside];
    for (let i = 0; i < 40; i++) {
      const m = Math.sqrt(a * b);
      if (clearAt(m) === id) {
        a = m;
      } else {
        b = m;
      }
    }
    return a;
  };
  const clear = grid.map(clearAt);

  // Runs of one gated winner, with exact edges and stated edges.
  type Run = { id: string; from: number; to: number; lo: number | null; hi: number | null };
  const runs: Run[] = [];
  for (let g = 0; g < grid.length; g++) {
    const id = clear[g];
    if (id === undefined || (g > 0 && clear[g - 1] === id)) {
      continue;
    }
    let e = g;
    while (e + 1 < grid.length && clear[e + 1] === id) {
      e++;
    }
    const from = g === 0 ? lo : edge(id, grid[g], grid[g - 1]);
    const to = e === grid.length - 1 ? hi : edge(id, grid[e], grid[e + 1]);
    // A stated edge: the first of the nearest nice value, the next nice value inward, then finer steps
    // inward, that lies inside the exact band where the gate holds in every capture, and within the
    // rounding slack of the exact edge (or, failing that, the first inside at all).
    const inside = (v: number) => v >= from * (1 - 1e-12) && v <= to * (1 + 1e-12) && clearAt(v) === id;
    const state = (x: number, way: "up" | "down", end: number): number | null | undefined => {
      if (x === end) {
        return null;
      }
      const ok = [roundNice(x), roundNice(x, way), roundFine(x, way), roundSig(x, way)].filter(inside);
      return ok.find((v) => Math.max(v / x, x / v) <= ROUNDING_SLACK * (1 + 1e-9)) ?? ok[0];
    };
    const [sLo, sHi] = [state(from, "up", lo), state(to, "down", hi)];
    if (sLo !== undefined && sHi !== undefined && (sLo === null || sHi === null || sLo < sHi)) {
      runs.push({ id, from, to, lo: sLo, hi: sHi });
    }
  }

  /** The contenders over [a, b]: within 3% of the fastest somewhere there, in some capture, fastest first at the middle. */
  const nearSet = (a: number, b: number) => {
    const pts = [a, ...grid.filter((x) => x > a && x < b), b];
    const ids = captures[0].map((l) => l.id).filter((id) => captures.every((c) => c.some((l) => l.id === id)));
    const contenders = ids.filter((id) =>
      pts.some((x) =>
        captures.some((lines) => {
          const r = rankAt(lines, x);
          const mine = r.find((y) => y.line.id === id)!;
          return mine === r[0] || sameRatio(mine.ms / r[0].ms);
        }),
      ),
    );
    const mid = rankAt(captures[0], Math.sqrt(a * b)).map((x) => x.line.id);
    return contenders.sort((p, q) => mid.indexOf(p) - mid.indexOf(q));
  };

  // An about-the-same stretch between stated edges that meet states nothing: no band of its own.
  const meets = (a: number | null, b: number | null) => a === b;
  const bands: Band[] = [];
  let cursor = lo;
  let statedHi: number | null = null;
  for (const r of runs) {
    if (r.from > cursor && !meets(statedHi, r.lo)) {
      bands.push({ from: cursor, to: r.from, lo: statedHi, hi: r.lo, near: nearSet(cursor, r.from) });
    }
    bands.push({ from: r.from, to: r.to, lo: r.lo, hi: r.hi, winner: r.id, near: [r.id] });
    cursor = r.to;
    statedHi = r.hi;
  }
  if (cursor < hi && !(runs.length > 0 && meets(statedHi, null))) {
    bands.push({ from: cursor, to: hi, lo: statedHi, hi: null, near: nearSet(cursor, hi) });
  }
  return bands;
}

/**
 * How far a band's winner leads the runner-up, over the band and every
 * capture: the smallest and largest (runner-up ÷ winner − 1). Undefined
 * for an about-the-same band.
 */
export function bandLead(captures: readonly (readonly Line[])[], band: Band, grid: readonly number[] = GRID): { min: number; max: number } | undefined {
  if (!band.winner) {
    return undefined;
  }
  const pts = [band.from, ...grid.filter((x) => x > band.from && x < band.to), band.to];
  const leads = pts.flatMap((b) =>
    captures.flatMap((lines) => {
      const [a, n] = rankAt(lines, b);
      return a && n && a.line.id === band.winner ? [n.ms / a.ms - 1] : [];
    }),
  );
  return leads.length ? { min: Math.min(...leads), max: Math.max(...leads) } : undefined;
}

// ---------------------------------------------------------------------------
// Storage: what an upload costs to keep, if the server stores the client's bytes
// ---------------------------------------------------------------------------

/**
 * S3 Standard storage in us-east-1, first 50 TB: dollars per GiB-month.
 * AWS bills storage in binary gigabytes, 1 GB = 2³⁰ bytes. Published at
 * https://aws.amazon.com/s3/pricing/, checked November 2026. One copy;
 * replicas and other storage classes change it; request charges are left
 * out (they don't depend on compression), and so is egress.
 */
export const S3_STORAGE = {
  perGiBMonth: 0.023,
  what: "S3 Standard, us-east-1, first 50 TB",
  url: "https://aws.amazon.com/s3/pricing/",
  checked: "November 2026",
} as const;

const GiB = 2 ** 30;
/** The unit storage is quoted for: 1 TB = 10¹² bytes of original (uncompressed) data. */
const TB = 1e12;

/**
 * Dollars a month to keep 1 TB of original data stored compressed as a
 * configuration compresses it (`size` bytes out per `original` bytes in),
 * one copy, one month. It doesn't depend on the sample file's size, only
 * on the ratio.
 */
export const storagePerTB = (size: number, original: number) => (((TB * size) / original) / GiB) * S3_STORAGE.perGiBMonth;

/** One configuration's storage cost per TB of data, and how it compares with another's. */
export type Storage = {
  line: Line;
  cost: number;
  /** Against another configuration: size ÷ its size − 1, and the difference in dollars a month per TB. */
  vs?: { line: Line; larger: number; extra: number };
};

/**
 * What `id`'s output costs to keep per TB of original data, against
 * `otherId`'s if given. Uncompressed keeps the original bytes: $21.42.
 */
export function storageOf(lines: readonly Line[], id: string, otherId?: string): Storage | undefined {
  const line = lines.find((l) => l.id === id);
  const original = lines.find((l) => l.id === UNCOMPRESSED)?.bytes;
  if (!line || !original) {
    return undefined;
  }
  const cost = storagePerTB(line.bytes, original);
  const other = otherId === undefined ? undefined : lines.find((l) => l.id === otherId);
  return {
    line,
    cost,
    vs: other ? { line: other, larger: line.bytes / other.bytes - 1, extra: cost - storagePerTB(other.bytes, original) } : undefined,
  };
}

/** Of `ids` (all configurations when omitted, Uncompressed aside), the one with the smallest output. */
export function smallestOutput(lines: readonly Line[], ids?: readonly string[]): Line | undefined {
  const pool = lines.filter((l) => l.id !== UNCOMPRESSED && (!ids || ids.includes(l.id)));
  return pool.length ? pool.reduce((a, b) => (b.bytes < a.bytes ? b : a)) : undefined;
}

/** "$0.98", "$12.40", "$123". */
export const dollars = (x: number) => (Math.abs(x) < 100 ? `$${x.toFixed(2)}` : `$${Math.round(x)}`);

// ---------------------------------------------------------------------------
// Words and numbers
// ---------------------------------------------------------------------------

const seq = (x: number, steps: readonly number[]) => {
  const e = Math.floor(Math.log10(x));
  return [-1, 0, 1].flatMap((d) => steps.map((m) => +(m * 10 ** (e + d)).toPrecision(12)));
};

const pick = (options: number[], x: number, way: "nearest" | "up" | "down") => {
  if (way === "up") {
    return options.find((v) => v >= x * (1 - 1e-9))!;
  }
  if (way === "down") {
    return options.findLast((v) => v <= x * (1 + 1e-9))!;
  }
  return options.reduce((best, v) => (Math.abs(Math.log(v / x)) < Math.abs(Math.log(best / x)) ? v : best));
};

/** How far a stated value may sit from the true one before the finer series is used. */
export const ROUNDING_SLACK = 1.3;

/**
 * A bandwidth as the text states it: the nearest value on the 1-2-5
 * sequence on a log scale (13 → 10, 22 → 20), or the next one up or
 * down. Where that lands more than 1.3× from the true value, the finer
 * 1-1.5-2-3-5-7 series instead (15 → 15, 32 → 30, 335 → 300).
 */
export function roundNice(x: number, way: "nearest" | "up" | "down" = "nearest"): number {
  const coarse = pick(seq(x, [1, 2, 5]), x, way);
  return Math.max(coarse / x, x / coarse) > ROUNDING_SLACK * (1 + 1e-9) ? pick(seq(x, [1, 1.5, 2, 3, 5, 7]), x, way) : coarse;
}

/** The next value on the 1-1.2-1.5-2-2.5-3-4-5-6-7-8 series up or down: for edges the coarser series can't state. */
export const roundFine = (x: number, way: "up" | "down") => pick(seq(x, [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8]), x, way);

/** Two significant figures, rounded up or down: the last resort for a narrow band's edge. */
export function roundSig(x: number, way: "up" | "down"): number {
  const step = 10 ** (Math.floor(Math.log10(x)) - 1);
  const k = x / step;
  return +((way === "up" ? Math.ceil(k - 1e-9) : Math.floor(k + 1e-9)) * step).toPrecision(12);
}

/** "20 Mbps", "1 Gbps", "1.5 Mbps". */
export const bandwidthText = (mbps: number) => (mbps >= 1000 ? `${+(mbps / 1000).toPrecision(3)} Gbps` : `${+mbps.toPrecision(mbps < 10 ? 2 : 3)} Mbps`);

/** "8.2 s", "950 ms", "12 ms": two or three significant figures. */
export function timeText(ms: number): string {
  if (ms >= 1000) {
    const s = ms / 1000;
    return `${+s.toPrecision(s >= 100 ? 3 : 2)} s`;
  }
  return `${+ms.toPrecision(ms >= 100 ? 3 : 2)} ms`;
}
