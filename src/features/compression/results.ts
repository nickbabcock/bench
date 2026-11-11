import {
  type Placing,
  placings,
  summarize,
  type Summary,
} from "@/lib/stats";
import { familyInfo } from "./codecs";
import { codeSizeOf } from "./codeSize";
import { configLabel } from "./harness";
import type { CompressionRun, ConfigResult } from "./types";

export type Row = {
  id: string;
  label: string;
  name: string;
  level: number | null;
  order: number;
  family: ConfigResult["spec"]["family"];
  decodeOnly: boolean;
  code?: ConfigResult["code"];
  size?: number;
  ratio?: number;
  roundTrip?: boolean;
  /** Throughput in bytes per second (of uncompressed data). */
  encode?: Summary;
  decode?: Summary;
  /** Every sample's time per operation, ms, in the order taken. */
  encodeMs: number[];
  decodeMs: number[];
  /** The input's size, bytes. */
  bytes: number;
};

const throughput = (bytes: number, msPerOp: number[]) =>
  msPerOp.length === 0
    ? undefined
    : summarize(msPerOp.map((ms) => bytes / (ms / 1000)));

export function resultRows(run: CompressionRun): Row[] {
  return run.configs.map((c, order) => ({
    id: c.spec.id,
    label: configLabel(c.spec),
    name: familyInfo[c.spec.family].name,
    level: c.spec.level,
    order,
    family: c.spec.family,
    decodeOnly: Boolean(familyInfo[c.spec.family].decodesFrom),
    // Build-time sizes, the same in every browser; a capture's own (from its browser's gzip) only if this build has none.
    code: codeSizeOf(c.spec.family) ?? c.code,
    size: c.size,
    ratio: c.size ? run.bytes / c.size : undefined,
    roundTrip: c.roundTrip,
    encode: throughput(run.bytes, c.encodeMs),
    decode: throughput(run.bytes, c.decodeMs),
    encodeMs: c.encodeMs,
    decodeMs: c.decodeMs,
    bytes: run.bytes,
  }));
}

export type Metric = "ratio" | "encode" | "decode";

/** A metric as a summary; ratio is deterministic, so its range is a point. */
export function metricSummary(row: Row, metric: Metric): Summary | undefined {
  if (metric === "ratio") {
    if (row.ratio === undefined || row.decodeOnly) {
      return undefined;
    }
    // Ranked as displayed (three significant figures), so ratios that read
    // the same share a position.
    const shown = Number(row.ratio.toPrecision(3));
    return { median: shown, min: shown, max: shown, spread: 0, n: 1 };
  }
  return row[metric];
}

export type Ranked = {
  row: Row;
  placing: Placing;
  summary: Summary;
};

/**
 * Rows that have a value for `metric`, best first. Positions and groups
 * come from `placings` alone, so the table, the chart and the verdict apply
 * one rule: overlapping ranges, or speeds under 3% apart, share a position.
 * Ratio is exact (a compressed size doesn't vary between runs), so it has
 * no practical floor: ratios share a position only when they read the same.
 */
export function rankRows(rows: Row[], metric: Metric): Ranked[] {
  const scored = rows
    .filter((row) => row.roundTrip !== false)
    .map((row) => ({ row, s: metricSummary(row, metric) }))
    .filter((x): x is { row: Row; s: Summary } => x.s !== undefined)
    .sort((a, b) => b.s.median - a.s.median || a.row.order - b.row.order);
  const places = placings(
    scored.map((x) => x.s),
    metric === "ratio" ? { floor: 0 } : {},
  );
  return scored.map((x, i) => ({ row: x.row, placing: places[i], summary: x.s }));
}

/** The fewest samples any measured configuration got (partial runs). */
export function samplesCollected(rows: Row[]) {
  const counts = rows.flatMap((r) => (r.decode ? [r.decode.n] : []));
  return counts.length ? Math.min(...counts) : 0;
}
