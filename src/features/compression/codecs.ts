export const families = [
  "native",
  "lz4",
  "zstd",
  "zstdldm",
  "miniz",
  "zune",
  "libdeflate",
  "zlibrs",
  "brotli",
  "pako",
  "fflate",
] as const;

export type Family = (typeof families)[number];

/**
 * Compression formats: what a reader chooses first. Each library is one
 * implementation of one format (gzip, zlib and raw deflate are three
 * wrappings of one Deflate format).
 */
export const formats = ["deflate", "zstd", "lz4", "brotli"] as const;
export type FormatId = (typeof formats)[number];

export type FormatInfo = {
  name: string;
  /** The level its implementations' decoders are compared at (each decoding its own encoder's output); an implementation with one default level uses that. */
  typicalLevel?: number;
};

export const formatInfo: Record<FormatId, FormatInfo> = {
  deflate: { name: "Deflate", typicalLevel: 6 },
  zstd: { name: "Zstandard", typicalLevel: 3 },
  lz4: { name: "LZ4" },
  brotli: { name: "Brotli" },
};

export type FamilyInfo = {
  /** The library as engineers write it. */
  name: string;
  format: FormatId;
  /** The wrapping it reads and writes: "gzip", "zlib", "raw deflate", "frame". */
  container: string;
  runtime: "Browser" | "Wasm" | "JS";
  /** Compression levels benchmarked; `null` means the library's default. */
  levels: readonly (number | null)[];
  /** Decoder only: it decodes data produced (untimed) by another codec. */
  decodesFrom?: { family: Family; level: number };
  /** The same implementation with other settings (zstd with long-distance matching): not a second implementation. */
  variantOf?: Family;
  /** What its usual decode verifies: a property, never part of a speed. */
  checksum: string;
  /** Settings this site uses that differ from the library's defaults. */
  settings?: string;
  /** A variant left off by default; the reader opts in. */
  optIn?: boolean;
};

export const familyInfo: Record<Family, FamilyInfo> = {
  native: {
    name: "Browser gzip",
    format: "deflate",
    container: "gzip",
    runtime: "Browser",
    levels: [null],
    checksum: "CRC-32",
    settings: "via the Streams API",
  },
  lz4: { name: "lz4_flex", format: "lz4", container: "frame", runtime: "Wasm", levels: [null], checksum: "off by default" },
  zstd: { name: "zstd", format: "zstd", container: "frame", runtime: "Wasm", levels: [1, 3, 9, 15], checksum: "off by default" },
  zstdldm: {
    name: "zstd (LDM)",
    format: "zstd",
    container: "frame",
    runtime: "Wasm",
    levels: [1, 3, 9],
    variantOf: "zstd",
    checksum: "off by default",
    settings: "long-distance matching on, 4 MiB window at every level",
    optIn: true,
  },
  miniz: { name: "miniz_oxide", format: "deflate", container: "raw deflate", runtime: "Wasm", levels: [1, 6, 9], checksum: "none" },
  zune: {
    name: "zune-inflate",
    format: "deflate",
    container: "raw deflate",
    runtime: "Wasm",
    levels: [null],
    decodesFrom: { family: "miniz", level: 6 },
    checksum: "none",
  },
  libdeflate: { name: "libdeflate", format: "deflate", container: "gzip", runtime: "Wasm", levels: [1, 6, 9], checksum: "CRC-32" },
  zlibrs: { name: "zlib-rs", format: "deflate", container: "raw deflate", runtime: "Wasm", levels: [1, 6, 9], checksum: "none" },
  brotli: { name: "brotli", format: "brotli", container: "stream", runtime: "Wasm", levels: [1, 4, 9], checksum: "none" },
  pako: { name: "pako", format: "deflate", container: "zlib", runtime: "JS", levels: [1, 6, 9], checksum: "Adler-32" },
  fflate: { name: "fflate", format: "deflate", container: "gzip", runtime: "JS", levels: [1, 6, 9], checksum: "CRC-32 not checked" },
};

/** A format's implementations, in `families` order: variants (zstd with LDM) are not separate implementations. */
export const implementationsOf = (format: FormatId): Family[] => families.filter((f) => familyInfo[f].format === format && !familyInfo[f].variantOf);

/** Formats with a choice of implementation: two or more, so the page compares them. */
export const multiImplementationFormats = (): FormatId[] => formats.filter((f) => implementationsOf(f).length >= 2);

export type ConfigSpec = {
  /** Stable id, e.g. "zstd-3" or "lz4". */
  id: string;
  family: Family;
  level: number | null;
};

export const configId = (family: Family, level: number | null) =>
  level === null ? family : `${family}-${level}`;

export function plannedConfigs(
  enabled: Record<Family, boolean>,
  nativeSupported: boolean,
): ConfigSpec[] {
  return families
    .filter((family) => enabled[family])
    .filter((family) => family !== "native" || nativeSupported)
    .flatMap((family) =>
      familyInfo[family].levels.map((level) => ({
        id: configId(family, level),
        family,
        level,
      })),
    );
}

export const supportsCompressionStreams = () =>
  typeof CompressionStream !== "undefined" &&
  typeof DecompressionStream !== "undefined";

/** The build-info library each family is measured through. */
export const libraryKey: Record<Family, string | undefined> = {
  native: undefined,
  lz4: "lz4_flex",
  zstd: "zstd",
  zstdldm: "zstd",
  miniz: "miniz_oxide",
  zune: "zune-inflate",
  libdeflate: "libdeflater",
  zlibrs: "zlib-rs",
  brotli: "brotli",
  pako: "pako",
  fflate: "fflate",
};

