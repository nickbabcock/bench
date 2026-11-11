/**
 * The build-settings matrix: a handful of existing workloads, each built
 * with SIMD off and on and post-processed with wasm-opt off, -Os and -O3
 * (see scripts/build-variants.ts). Rust is at the release profile, opt-level
 * 3, in every variant.
 */

export type Simd = "off" | "on";
export type Opt = "none" | "Os" | "O3";
/** One built artifact: a SIMD setting and a wasm-opt level. */
export type ArtifactId = `${Simd}-${Opt}`;
/**
 * The A/A control: the baseline artifact (off-Os) instantiated a second
 * time, as its own instance with its own memory, timed in the same
 * rotation. Any effect it shows against the baseline is measurement noise.
 */
export const AA = "off-Os-aa";
export type VariantId = ArtifactId | typeof AA;

export const simds: readonly Simd[] = ["off", "on"];
export const opts: readonly Opt[] = ["none", "Os", "O3"];
export const artifactIds: readonly ArtifactId[] = simds.flatMap((s) => opts.map((o) => `${s}-${o}` as ArtifactId));
/** Every timed variant: the six artifacts plus the A/A control. */
export const variantIds: readonly VariantId[] = [...artifactIds, AA];

/**
 * What every ratio is relative to: the build every other page on the site
 * ships (no SIMD, wasm-opt -Os). Ratios then read as "what changing the
 * site's settings would buy", and the no-wasm-opt column reads as "what
 * skipping wasm-opt costs".
 */
export const BASELINE = "off-Os" satisfies ArtifactId;

/** The artifact a variant runs: the A/A control runs the baseline's. */
export const artifactOf = (id: VariantId): ArtifactId => (id === AA ? BASELINE : id);

export const subjects = {
  "zstd-decode": {
    crate: "zstd_read",
    label: "zstd decode",
    language: "C",
    detail: "libzstd 1.5.7 (zstd-sys) decompressing a level-3 frame",
  },
  "zlib-rs-inflate": {
    crate: "zlib_rs",
    label: "zlib-rs inflate",
    language: "Rust",
    detail: "zlib-rs (via flate2) inflating a level-6 raw deflate stream; explicit simd128 chunk copies",
  },
  // Deflate at the levels where longest_match/compare256 dominate: level 6
  // (deflate_medium) and level 9 (deflate_slow, long hash chains); level 1
  // (deflate_quick) calls compare256 directly, a different hot loop. Their
  // simd128 compare256 ends in i8x16.bitmask, one pmovmskb on x86-64 but
  // a multi-instruction sequence on arm64, so the effect depends on the CPU.
  "zlib-rs-deflate-1": {
    crate: "zlib_rs",
    label: "zlib-rs deflate L1",
    language: "Rust",
    level: 1,
    detail: "zlib-rs (via flate2) deflating at level 1 (deflate_quick); explicit simd128 compare256, slide_hash",
  },
  "zlib-rs-deflate": {
    crate: "zlib_rs",
    label: "zlib-rs deflate L6",
    language: "Rust",
    level: 6,
    detail: "zlib-rs (via flate2) deflating at level 6 (deflate_medium); explicit simd128 compare256, slide_hash",
  },
  "zlib-rs-deflate-9": {
    crate: "zlib_rs",
    label: "zlib-rs deflate L9",
    language: "Rust",
    level: 9,
    detail: "zlib-rs (via flate2) deflating at level 9 (deflate_slow); explicit simd128 compare256, slide_hash",
  },
  "lz4-decode": {
    crate: "lz4",
    label: "lz4_flex decode",
    language: "Rust",
    detail: "lz4_flex frame decoder; no explicit SIMD, autovectorization only",
  },
  "brotli-encode": {
    crate: "br_write",
    label: "brotli encode",
    language: "Rust",
    detail: "the brotli crate compressing at quality 4 (22-bit window); autovectorization only",
  },
  // Application code: no explicit SIMD path, unlike the codec kernels
  // above. It asks whether simd128 helps ordinary code that only
  // autovectorizes. Not a noise control: the A/A variant is the only one.
  alloc: {
    crate: "alloc",
    label: "XML document processing (dlmalloc)",
    language: "Rust",
    kind: "application",
    detail:
      "Application code: the allocation page's workload on Rust's default allocator, parsing, walking and dropping each of the Silesia xml file's 21 XML documents. No explicit SIMD; the simd128 build autovectorizes some loops",
  },
} as const;

export type SubjectKey = keyof typeof subjects;
export const subjectKeys = Object.keys(subjects) as SubjectKey[];
export type Crate = (typeof subjects)[SubjectKey]["crate"];

/** Each crate's module, as readers know it. */
export const crateLabels: Record<Crate, string> = {
  zstd_read: "zstd decoder",
  zlib_rs: "zlib-rs",
  lz4: "lz4_flex",
  br_write: "brotli encoder",
  alloc: "XML processing",
};

/** Each crate's module as an instance of code, for the A/A control: "a second instance of the zstd decoder". */
export const moduleNouns: Record<Crate, string> = {
  zstd_read: "zstd decoder",
  zlib_rs: "zlib-rs module",
  lz4: "lz4_flex decoder",
  br_write: "brotli encoder",
  alloc: "XML module",
};

/** Subjects that ignore the corpus (run once, not once per corpus). */
export const usesInput = (subject: SubjectKey) => subject !== "alloc";

/** The allocation workload's input: the Silesia xml file, a tar of XML documents, loaded once untimed. */
export const ALLOC_CORPUS = "xml";
/** Mid levels, from the compression page's level sets. */
export const ZSTD_LEVEL = 3;
export const DEFLATE_LEVEL = 6;
export const BROTLI_QUALITY = 4;

/** Generated by build:variants, one per crate × variant. */
export type Manifest = {
  crate: Crate;
  package: string;
  simd: Simd;
  opt: Opt;
  wasm: string;
  bytes: { raw: number; gzip: number; brotli: number };
  compression: { gzipLevel: number; brotliQuality: number };
  simdOps: { instructions: number; functions: number; top: Record<string, number> };
  flags: {
    cargo: string;
    env: Record<string, string>;
    profile: string;
    wasmBindgen: string;
    wasmOpt: string | null;
  };
  toolchain: { rustc: string; wasmBindgen: string; wasmOpt: string };
};

const manifestFiles = import.meta.glob<Manifest>("/src/wasm/variants/*/*/manifest.json", {
  eager: true,
  import: "default",
});

/** Every variant's manifest, keyed by crate then variant. Empty before build:variants. */
export const manifests = Object.values(manifestFiles).reduce(
  (acc, m) => {
    (acc[m.crate] ??= {})[`${m.simd}-${m.opt}`] = m;
    return acc;
  },
  {} as Partial<Record<Crate, Partial<Record<ArtifactId, Manifest>>>>,
);
