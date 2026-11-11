import type { BuildInfo } from "../../../build-info";
import type { Family } from "./codecs";

// Injected by Vite's `define` (vite.config.ts). Read guarded, not through
// @/lib/build, so unit tests (which don't define it) fall back to a
// capture's own sizes.
// oxlint-disable-next-line no-underscore-dangle
declare const __BUILD_INFO__: BuildInfo | undefined;
// oxlint-disable-next-line no-underscore-dangle
const built = typeof __BUILD_INFO__ === "undefined" ? undefined : __BUILD_INFO__.codeSizes;

export type CodeSize = {
  /** Gzipped bytes to decode and to encode; null when not applicable. */
  decode: number | null;
  encode: number | null;
  /** One module does both. */
  shared: boolean;
  source: "measured" | "published" | "built-in";
};

/**
 * The files each library ships to decode and to encode: wasm modules by
 * their artifact name under src/wasm, and the published minified JS
 * builds (pako has inflate-only and deflate-only entries; fflate is one
 * bundle with no inflate-only build). Browser gzip ships nothing.
 * zune-inflate only decodes.
 */
const shipped: Partial<Record<Family, { decode: string[]; encode: string[]; source: "measured" | "published" }>> = {
  lz4: { decode: ["lz4_bg.wasm"], encode: ["lz4_bg.wasm"], source: "measured" },
  zstd: { decode: ["zstd_read_bg.wasm"], encode: ["zstd_write_bg.wasm"], source: "measured" },
  zstdldm: { decode: ["zstd_read_bg.wasm"], encode: ["zstd_write_bg.wasm"], source: "measured" },
  miniz: { decode: ["miniz_bg.wasm"], encode: ["miniz_bg.wasm"], source: "measured" },
  zune: { decode: ["zune_bg.wasm"], encode: [], source: "measured" },
  libdeflate: { decode: ["libdeflate_bg.wasm"], encode: ["libdeflate_bg.wasm"], source: "measured" },
  zlibrs: { decode: ["zlib_rs_bg.wasm"], encode: ["zlib_rs_bg.wasm"], source: "measured" },
  brotli: { decode: ["br_read_bg.wasm"], encode: ["br_write_bg.wasm"], source: "measured" },
  pako: { decode: ["pako/inflate"], encode: ["pako/deflate"], source: "published" },
  fflate: { decode: ["fflate"], encode: ["fflate"], source: "published" },
};

/** The gzip level the build used for code sizes (build-info.ts). */
export const codeGzipLevel = built?.gzipLevel;

/**
 * Gzipped code a library ships, computed at build time (build-info.ts),
 * so it is the same in every browser and every capture. Undefined when
 * this build has no size for one of its files.
 */
export function codeSizeOf(family: Family): CodeSize | undefined {
  const files = shipped[family];
  if (!files) {
    return { decode: null, encode: null, shared: false, source: "built-in" };
  }
  const sizes: Record<string, number> = built?.files ?? {};
  if ([...files.decode, ...files.encode].some((f) => sizes[f] === undefined)) {
    return undefined;
  }
  const total = (names: string[]) => (names.length === 0 ? null : names.reduce((s, n) => s + sizes[n], 0));
  return { decode: total(files.decode), encode: total(files.encode), shared: files.decode.join() === files.encode.join(), source: files.source };
}
