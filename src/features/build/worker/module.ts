import zstdWritePath from "@/wasm/zstd_write_bg.wasm?url";
import { loadCorpus } from "@/features/compression/corpora";
import { load } from "@/lib/wasm";
import {
  AA,
  ALLOC_CORPUS,
  artifactOf,
  type ArtifactId,
  BASELINE,
  BROTLI_QUALITY,
  type Crate,
  DEFLATE_LEVEL,
  type SubjectKey,
  subjects,
  type VariantId,
  variantIds,
  ZSTD_LEVEL,
} from "../subjects";

type Bytes = Uint8Array<ArrayBuffer>;

const zstdWrite = load({ js: () => import("@/wasm/zstd_write"), wasm: zstdWritePath });

/** The wasm-bindgen glue of one variant: init plus the crate's exports. */
type Glue = {
  default: (args: { module_or_path: string }) => Promise<{ memory: WebAssembly.Memory }>;
} & Record<string, unknown>;

// One glue module per variant directory, so each variant is its own
// instance with its own memory and all of them can be live at once.
const glues = import.meta.glob<Glue>("/src/wasm/variants/*/*/*.js");
// The A/A control needs a second, independent instance of the baseline.
// wasm-bindgen glue keeps its instance in module state, so the query makes
// the bundler treat it as a separate module (same code, same wasm bytes).
const aaGlues = import.meta.glob<Glue>("/src/wasm/variants/*/off-Os/*.js", { query: "?aa" });
const wasmUrls = import.meta.glob<string>("/src/wasm/variants/*/*/*_bg.wasm", {
  query: "?url",
  import: "default",
  eager: true,
});

/** Each prepared variant's linear memory: distinct objects mean distinct instances. */
const instances = new Map<VariantId, WebAssembly.Memory>();

const dir = (crate: Crate, variant: ArtifactId) => `/src/wasm/variants/${crate}/${variant}/`;

async function instantiate(crate: Crate, variant: VariantId): Promise<Glue> {
  const base = dir(crate, artifactOf(variant));
  const glue = (variant === AA ? aaGlues : glues)[`${base}${crate}.js`];
  const wasm = wasmUrls[`${base}${crate}_bg.wasm`];
  if (!glue || !wasm) {
    throw new Error(`Missing ${crate} ${variant}; run \`mise run build:variants\``);
  }
  const mod = await glue();
  const { memory } = await mod.default({ module_or_path: wasm });
  instances.set(variant, memory);
  return mod;
}

const fn = <A extends unknown[], R>(mod: Glue, name: string) => mod[name] as (...args: A) => R;

/** FNV-1a over the bytes plus their length: cheap, order-sensitive. */
function checksum(out: Bytes | number): number {
  if (typeof out === "number") {
    return out;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < out.length; i++) {
    h = Math.imul(h ^ out[i], 0x01000193);
  }
  return (h ^ out.length) >>> 0;
}

/** Build the subject's untimed inputs, using the baseline build to encode. */
async function payload(subject: SubjectKey, input: Bytes): Promise<Bytes> {
  switch (subject) {
    case "zstd-decode": {
      // The site's own zstd encoder: zstd_write isn't in the matrix.
      const w = await zstdWrite();
      return w.compress(input, ZSTD_LEVEL, false) as Bytes;
    }
    case "zlib-rs-inflate": {
      const m = await instantiate("zlib_rs", BASELINE);
      return fn<[Bytes, number], Bytes>(m, "compress_bench")(input, DEFLATE_LEVEL);
    }
    case "lz4-decode": {
      const m = await instantiate("lz4", BASELINE);
      return fn<[Bytes], Bytes>(m, "compress")(input);
    }
    case "zlib-rs-deflate-1":
    case "zlib-rs-deflate":
    case "zlib-rs-deflate-9":
    case "brotli-encode":
      return input;
    case "alloc":
      // The allocation workload reads its own input, whatever the matrix passes.
      return (await loadCorpus(ALLOC_CORPUS)).bytes;
  }
}

function workFor(subject: SubjectKey, mod: Glue, data: Bytes): () => Bytes | number {
  switch (subject) {
    case "zstd-decode":
    case "lz4-decode": {
      const decompress = fn<[Bytes], Bytes>(mod, "decompress");
      return () => decompress(data);
    }
    case "zlib-rs-inflate": {
      const decompress = fn<[Bytes], Bytes>(mod, "decompress_bench");
      return () => decompress(data);
    }
    case "zlib-rs-deflate-1":
    case "zlib-rs-deflate":
    case "zlib-rs-deflate-9": {
      const compress = fn<[Bytes, number], Bytes>(mod, "compress_bench");
      const level = subjects[subject].level;
      return () => compress(data, level);
    }
    case "brotli-encode": {
      const compress = fn<[Bytes, number], Bytes>(mod, "compress");
      return () => compress(data, BROTLI_QUALITY);
    }
    case "alloc": {
      // Hand the documents over once, untimed; each run is one batch over all of them.
      fn<[Bytes], Uint32Array>(mod, "load_documents")(data);
      const processDocuments = fn<[], number>(mod, "process_documents");
      return () => processDocuments();
    }
  }
}

const work = new Map<VariantId, () => Bytes | number>();

export type PrepareResult = {
  /** Bytes each run reads: the encoded payload for decoders, else the input. */
  payloadBytes: number;
  /** Decoders: whether the baseline round-trips the input exactly. */
  roundTrips: boolean | null;
};

/**
 * Instantiate every variant of the subject's crate and build its inputs
 * (untimed). All variants are prepared before any runs, so none gets extra
 * background compilation time.
 */
export async function prepare(subject: SubjectKey, input: Bytes): Promise<PrepareResult> {
  work.clear();
  const data = await payload(subject, input);
  for (const variant of variantIds) {
    work.set(variant, workFor(subject, await instantiate(subjects[subject].crate, variant), data));
  }
  if (instances.get(AA) === instances.get(BASELINE)) {
    throw new Error("The A/A control shares the baseline's instance");
  }
  const decoder = subject === "zstd-decode" || subject === "zlib-rs-inflate" || subject === "lz4-decode";
  return {
    payloadBytes: data.length,
    roundTrips: decoder ? checksum(work.get(BASELINE)!() as Bytes) === checksum(input) : null,
  };
}

export type RunResult = {
  /** Total time for all repetitions. */
  elapsedMs: number;
  /** Checksum of the last repetition's output (computed untimed). */
  checksum: number;
};

/** Run the variant's workload `repetitions` times back to back. */
export function run(variant: VariantId, repetitions: number): RunResult {
  const go = work.get(variant);
  if (!go) {
    throw new Error(`${variant} has not been prepared`);
  }
  let out: Bytes | number = 0;
  const start = performance.now();
  for (let i = 0; i < repetitions; i++) {
    out = go();
  }
  const elapsedMs = performance.now() - start;
  return { elapsedMs, checksum: checksum(out) };
}
