/**
 * Fixture data for /dev-kit: shaped like real results so every component
 * can be reviewed with realistic density. Not measurements; never import
 * this from a page.
 */
import type { Edition } from "@/lib/edition";
import { pairedEffect } from "@/lib/stats";

export type CompressionRow = {
  id: string;
  codec: string;
  detail?: string;
  level: number | null;
  ratio: number;
  /** MB/s: min, median, max. */
  enc?: [number, number, number];
  dec: [number, number, number];
  /** kB gzip'd: decoder, encoder (one value when a module does both). */
  code?: { dec?: number; enc?: number; both?: number; builtIn?: boolean };
};

export const compression: CompressionRow[] = [
  { id: "gzip", codec: "Browser gzip", detail: "CompressionStream", level: null, ratio: 2.65, enc: [151, 153, 155], dec: [1048, 1165, 1209], code: { builtIn: true } },
  { id: "lz4", codec: "lz4_flex", level: null, ratio: 1.63, enc: [827, 834, 861], dec: [2449, 2514, 2604], code: { both: 26.5 } },
  { id: "zstd-1", codec: "zstd", level: 1, ratio: 2.48, enc: [651, 669, 688], dec: [1201, 1236, 1259], code: { dec: 51.2, enc: 122 } },
  { id: "zstd-3", codec: "zstd", level: 3, ratio: 2.77, enc: [546, 550, 566], dec: [1180, 1214, 1240], code: { dec: 51.2, enc: 122 } },
  { id: "zstd-9", codec: "zstd", level: 9, ratio: 3.13, enc: [68, 70, 74], dec: [1262, 1290, 1318], code: { dec: 51.2, enc: 122 } },
  { id: "zstd-15", codec: "zstd", level: 15, ratio: 3.36, enc: [11, 13, 15], dec: [1310, 1352, 1380], code: { dec: 51.2, enc: 122 } },
  { id: "miniz-1", codec: "miniz_oxide", level: 1, ratio: 2.27, enc: [397, 402, 409], dec: [531, 543, 555], code: { both: 25.5 } },
  { id: "miniz-6", codec: "miniz_oxide", level: 6, ratio: 2.64, enc: [93, 97, 99], dec: [579, 591, 602], code: { both: 25.5 } },
  { id: "miniz-9", codec: "miniz_oxide", level: 9, ratio: 2.65, enc: [36, 40, 40], dec: [582, 593, 604], code: { both: 25.5 } },
  { id: "zune", codec: "zune-inflate", detail: "decodes miniz_oxide 6", level: null, ratio: 2.64, dec: [1496, 1585, 1596], code: { dec: 14 } },
  { id: "libdeflate-1", codec: "libdeflate", level: 1, ratio: 2.37, enc: [337, 344, 346], dec: [881, 898, 911], code: { both: 35.6 } },
  { id: "libdeflate-6", codec: "libdeflate", level: 6, ratio: 2.7, enc: [149, 150, 152], dec: [951, 976, 986], code: { both: 35.6 } },
  { id: "libdeflate-9", codec: "libdeflate", level: 9, ratio: 2.73, enc: [32, 32, 35], dec: [938, 966, 981], code: { both: 35.6 } },
  { id: "zlibrs-1", codec: "zlib-rs", level: 1, ratio: 2.34, enc: [469, 473, 477], dec: [1013, 1045, 1094], code: { both: 56.4 } },
  { id: "zlibrs-6", codec: "zlib-rs", level: 6, ratio: 2.64, enc: [125, 126, 127], dec: [1217, 1253, 1297], code: { both: 56.4 } },
  { id: "zlibrs-9", codec: "zlib-rs", level: 9, ratio: 2.65, enc: [87, 87, 90], dec: [1228, 1249, 1338], code: { both: 56.4 } },
  { id: "brotli-1", codec: "brotli", level: 1, ratio: 2.24, enc: [209, 213, 216], dec: [471, 473, 477], code: { dec: 101, enc: 527 } },
  { id: "brotli-4", codec: "brotli", level: 4, ratio: 2.69, enc: [163, 165, 171], dec: [857, 892, 925], code: { dec: 101, enc: 527 } },
  { id: "brotli-9", codec: "brotli", level: 9, ratio: 3.08, enc: [23, 24, 25], dec: [961, 993, 1025], code: { dec: 101, enc: 527 } },
  { id: "pako-6", codec: "pako", detail: "JavaScript", level: 6, ratio: 2.64, enc: [61, 63, 64], dec: [383, 388, 392], code: { dec: 10.7, enc: 8.54 } },
  { id: "fflate-6", codec: "fflate", detail: "JavaScript", level: 6, ratio: 2.62, enc: [70, 72, 74], dec: [361, 381, 390], code: { both: 12.6 } },
];

const label = (r: CompressionRow) => (r.level === null ? r.codec : `${r.codec} ${r.level}`);

export const allocators = [
  { id: "dlmalloc", label: "dlmalloc", detail: "Rust's default", us: [40.1, 41.2, 43.0] },
  { id: "talc", label: "talc", us: [37.2, 38.0, 39.9] },
  { id: "bumpalo", label: "bumpalo", us: [12.1, 12.4, 13.0] },
  { id: "bump-scope", label: "bump-scope", us: [11.5, 11.8, 12.6] },
];

/** Deterministic pseudo-random numbers, so fixtures don't change between renders. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Per-round ratios around `center`, with `noise` relative spread. */
function rounds(center: number, noise: number, seed: number, n = 15) {
  const r = rng(seed);
  return Array.from({ length: n }, () => center * (1 + (r() + r() + r() - 1.5) * noise));
}

/** `outlier`: one round replaced by this ratio, so the min–max runs past the axis (clipped with a caret). */
const effect = (center: number, noise: number, seed: number, outlier?: number) => {
  const xs = rounds(center, noise, seed);
  if (outlier !== undefined) {
    xs[7] = outlier;
  }
  const e = pairedEffect(xs);
  return { median: e.median, ci: [e.ci!.lo, e.ci!.hi] as const, range: [e.min, e.max] as const, claimed: e.claim === "faster" || e.claim === "slower", n: e.n };
};

export const effects = [
  { id: "zstd-dec", label: "zstd decode", detail: "dickens", cells: { chrome: effect(0.97, 0.02, 1), firefox: effect(0.94, 0.03, 2) } },
  { id: "zlib-inf", label: "zlib-rs inflate", detail: "dickens", cells: { chrome: effect(0.91, 0.02, 3), firefox: effect(0.95, 0.04, 4) } },
  { id: "lz4-dec", label: "lz4_flex decode", detail: "dickens", cells: { chrome: effect(1.01, 0.02, 5), firefox: effect(0.92, 0.03, 6) } },
  { id: "br-enc", label: "brotli encode", detail: "dickens", cells: { chrome: effect(1.02, 0.03, 7), firefox: effect(1.01, 0.02, 8, 1.4) } },
  { id: "deflate-6", label: "zlib-rs deflate L6", detail: "xml", cells: { chrome: effect(0.88, 0.03, 9), firefox: effect(0.9, 0.05, 10) } },
  { id: "alloc", label: "dlmalloc churn", detail: "no SIMD code", cells: { chrome: effect(1.0, 0.015, 11), firefox: effect(1.005, 0.02, 12) } },
  { id: "aa", label: "A/A control", detail: "baseline, second instance", cells: { chrome: effect(1.0, 0.012, 13), firefox: effect(0.998, 0.018, 14) } },
];

/** This machine ÷ reference per configuration, normalised by the geomean. */
export const thisVsRef = compression
  .filter((r) => r.enc)
  .slice(0, 9)
  .map((r, i) => {
    const v = [0.97, 1.01, 1.0, 1.06, 0.99, 0.95, 1.02, 0.98, 1.01][i];
    return { id: r.id, label: label(r), value: v, range: [v * 0.985, v * 1.02] as const, moved: Math.abs(v - 1) > 0.03 };
  });

const hex = (seed: number) => {
  const r = rng(seed);
  return Array.from({ length: 64 }, () => Math.floor(r() * 16).toString(16)).join("");
};

export const edition: Edition = {
  schema: 1,
  id: "2026-11-08",
  bench: "compression",
  input: "dickens",
  repeat: { index: 1, of: 2 },
  capturedAt: "2026-11-08T14:05:00Z",
  endedAt: "2026-11-08T14:31:00Z",
  machine: {
    id: "m4pro-arm64",
    cpuModel: "Apple M4 Pro",
    arch: "arm64",
    cores: 14,
    os: "macOS 26.1 (25B78)",
    cpuFlags: [],
    power: { source: "AC", lowPowerMode: false },
  },
  browser: {
    id: "chrome",
    name: "Chrome",
    version: "156.0.7444.60",
    userAgent: "Mozilla/5.0",
    headless: false,
    crossOriginIsolated: true,
    timerResolutionMs: 0.005,
    timerMinStepMs: 0.005,
  },
  toolchain: {
    rustc: "rustc 1.99.1 (58cf8f9c3 2026-10-13)",
    rustcNightly: "nightly-2026-11-01",
    wasiSdk: "wasi-sdk-29",
    binaryen: "wasm-opt version 133",
    wasmBindgen: "0.2.130",
    profile: { optLevel: "3", lto: "fat", codegenUnits: "1", targetFeatures: [], wasmOpt: "-Os" },
    crates: { lz4_flex: "0.11.5", zstd: "0.14.3 (libzstd 1.5.7)", brotli: "8.0.2", "zlib-rs": "0.5.2", miniz_oxide: "0.8.9", libdeflater: "1.24.0" },
  },
  commit: { sha: "8107f40c1e2b9a7d3f5e6a0b4c8d2e1f9a7b3c5d", dirty: false },
  artifacts: [
    { name: "zstd_bg.wasm", sha256: hex(21), bytes: 412_884 },
    { name: "brotli_bg.wasm", sha256: hex(22), bytes: 1_604_211 },
    { name: "lz4_bg.wasm", sha256: hex(23), bytes: 71_090 },
  ],
  corpus: [
    { id: "dickens", sha256: hex(31), bytes: 10_192_446 },
    { id: "xml", sha256: hex(32), bytes: 5_345_280 },
    { id: "x-ray", sha256: hex(33), bytes: 8_474_240 },
    { id: "samba", sha256: hex(34), bytes: 21_606_400 },
  ],
  method: { samples: 10, batchTargetMs: 50, warmup: { minMs: 250, minRounds: 2, maxRounds: 20 }, order: "rotate", paired: false },
  params: {},
  raw: null,
};
