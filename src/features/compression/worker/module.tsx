import brWritePath from "@/wasm/br_write_bg.wasm?url";
import brReadPath from "@/wasm/br_read_bg.wasm?url";
import minizPath from "@/wasm/miniz_bg.wasm?url";
import zstdReadPath from "@/wasm/zstd_read_bg.wasm?url";
import zstdWritePath from "@/wasm/zstd_write_bg.wasm?url";
import lz4Path from "@/wasm/lz4_bg.wasm?url";
import zunePath from "@/wasm/zune_bg.wasm?url";
import libdeflatePath from "@/wasm/libdeflate_bg.wasm?url";
import zlibrsPath from "@/wasm/zlib_rs_bg.wasm?url";
import type { GzipOptions } from "fflate";
import type { DeflateOptions } from "pako";
import { load } from "@/lib/wasm";
import { configId, type ConfigSpec, type Family, familyInfo } from "../codecs";
import { type CodeSize, codeSizeOf } from "../codeSize";

export type { CodeSize };

const miniz = load({ js: () => import("@/wasm/miniz"), wasm: minizPath });
const zstdRead = load({
  js: () => import("@/wasm/zstd_read"),
  wasm: zstdReadPath,
});
const zstdWrite = load({
  js: () => import("@/wasm/zstd_write"),
  wasm: zstdWritePath,
});
const lz4 = load({ js: () => import("@/wasm/lz4"), wasm: lz4Path });
const brRead = load({ js: () => import("@/wasm/br_read"), wasm: brReadPath });
const brWrite = load({
  js: () => import("@/wasm/br_write"),
  wasm: brWritePath,
});
const zune = load({ js: () => import("@/wasm/zune"), wasm: zunePath });
const libdeflate = load({
  js: () => import("@/wasm/libdeflate"),
  wasm: libdeflatePath,
});
const zlibrs = load({ js: () => import("@/wasm/zlib_rs"), wasm: zlibrsPath });

type Bytes = Uint8Array<ArrayBuffer>;
type Encode = (data: Bytes) => Bytes | Promise<Bytes>;
type Decode = (data: Bytes) => Bytes | Promise<Bytes>;

/** Encoder and decoder for one configuration, fully loaded and ready. */
type Codec = { encode?: Encode; decode: Decode; async: boolean };

async function viaStream(data: Bytes, stream: GenericTransformStream) {
  const pipe = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(pipe).arrayBuffer());
}

const asBytes = (x: Uint8Array) => x as Bytes;

async function loadCodec(family: Family, level: number | null): Promise<Codec> {
  const lvl = level ?? 0;
  switch (family) {
    case "native":
      return {
        async: true,
        encode: (d) => viaStream(d, new CompressionStream("gzip")),
        decode: (d) => viaStream(d, new DecompressionStream("gzip")),
      };
    case "lz4": {
      const m = await lz4();
      return {
        async: false,
        encode: (d) => asBytes(m.compress(d)),
        decode: (d) => asBytes(m.decompress(d)),
      };
    }
    case "zstd":
    case "zstdldm": {
      const [w, r] = await Promise.all([zstdWrite(), zstdRead()]);
      const ldm = family === "zstdldm";
      return {
        async: false,
        encode: (d) => asBytes(w.compress(d, lvl, ldm)),
        decode: (d) => asBytes(r.decompress(d)),
      };
    }
    case "miniz": {
      const m = await miniz();
      return {
        async: false,
        encode: (d) => asBytes(m.compress(d, lvl)),
        decode: (d) => asBytes(m.decompress(d)),
      };
    }
    case "zune": {
      const m = await zune();
      return { async: false, decode: (d) => asBytes(m.decompress(d)) };
    }
    case "libdeflate": {
      const m = await libdeflate();
      return {
        async: false,
        encode: (d) => asBytes(m.compress(d, lvl)),
        decode: (d) => asBytes(m.decompress(d)),
      };
    }
    case "zlibrs": {
      const m = await zlibrs();
      return {
        async: false,
        encode: (d) => asBytes(m.compress_bench(d, lvl)),
        decode: (d) => asBytes(m.decompress_bench(d)),
      };
    }
    case "brotli": {
      const [w, r] = await Promise.all([brWrite(), brRead()]);
      return {
        async: false,
        encode: (d) => asBytes(w.compress(d, lvl)),
        decode: (d) => asBytes(r.decompress(d)),
      };
    }
    case "pako": {
      const pako = await import("pako");
      const pakoLevel = lvl as DeflateOptions["level"];
      return {
        async: false,
        encode: (d) => asBytes(pako.deflate(d, { level: pakoLevel })),
        decode: (d) => asBytes(pako.inflate(d)),
      };
    }
    case "fflate": {
      const { gzipSync, gunzipSync } = await import("fflate");
      const gzipLevel = lvl as GzipOptions["level"];
      return {
        async: false,
        encode: (d) => asBytes(gzipSync(d, { level: gzipLevel })),
        decode: (d) => asBytes(gunzipSync(d)),
      };
    }
  }
}

/** Gzipped code for a library, computed at build time (see ../codeSize). */
export async function codeSize(family: Family): Promise<CodeSize> {
  return codeSizeOf(family) ?? { decode: null, encode: null, shared: false, source: "built-in" };
}

type Prepared = { codec: Codec; payload: Bytes };

let input: Bytes | undefined;
const prepared = new Map<string, Prepared>();

/** Hand the worker the file to benchmark. Clears earlier preparations. */
export function setInput(data: Bytes) {
  input = data;
  prepared.clear();
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};

export type PrepareResult = {
  /** Compressed size in bytes. */
  size: number;
  /** Whether decoding the payload reproduced the input byte for byte. */
  roundTrip: boolean;
  /** zstd only: the parameters zstd chose for this level and input size. */
  zstdParams?: number[];
};

/**
 * Load the configuration's code and produce its compressed payload, then
 * decode it once to check the round trip. Nothing here is timed.
 */
export async function prepare(spec: ConfigSpec): Promise<PrepareResult> {
  if (!input) {
    throw new Error("No input file set");
  }
  const codec = await loadCodec(spec.family, spec.level);
  const source = familyInfo[spec.family].decodesFrom;
  let payload: Bytes;
  if (codec.encode) {
    payload = await codec.encode(input);
  } else if (source) {
    const upstream =
      prepared.get(configId(source.family, source.level))?.payload ??
      (await (await loadCodec(source.family, source.level)).encode!(input));
    payload = upstream;
  } else {
    throw new Error(`${spec.id} can neither encode nor find a payload`);
  }
  const decoded = await codec.decode(payload);
  prepared.set(spec.id, { codec, payload });
  const zstdParams =
    spec.family === "zstd" || spec.family === "zstdldm"
      ? Array.from((await zstdWrite()).params(spec.level ?? 3, input.length))
      : undefined;
  return { size: payload.length, roundTrip: sameBytes(decoded, input), zstdParams };
}

function get(id: string) {
  const entry = prepared.get(id);
  if (!entry || !input) {
    throw new Error(`${id} has not been prepared`);
  }
  return { ...entry, source: input };
}

/**
 * Compress the input `repetitions` times back to back and return the total
 * elapsed milliseconds, so short operations stay above timer resolution.
 */
export async function timeEncode(id: string, repetitions: number) {
  const { codec, source } = get(id);
  const encode = codec.encode;
  if (!encode) {
    throw new Error(`${id} is decode-only`);
  }
  let sink = 0;
  const start = performance.now();
  if (codec.async) {
    for (let i = 0; i < repetitions; i++) {
      sink += (await encode(source)).length;
    }
  } else {
    for (let i = 0; i < repetitions; i++) {
      sink += (encode(source) as Bytes).length;
    }
  }
  const elapsedMs = performance.now() - start;
  if (sink === 0) {
    throw new Error(`${id} produced no output`);
  }
  return elapsedMs;
}

/** Decompress the prepared payload `repetitions` times; total elapsed ms. */
export async function timeDecode(id: string, repetitions: number) {
  const { codec, payload } = get(id);
  const decode = codec.decode;
  let sink = 0;
  const start = performance.now();
  if (codec.async) {
    for (let i = 0; i < repetitions; i++) {
      sink += (await decode(payload)).length;
    }
  } else {
    for (let i = 0; i < repetitions; i++) {
      sink += (decode(payload) as Bytes).length;
    }
  }
  const elapsedMs = performance.now() - start;
  if (sink === 0) {
    throw new Error(`${id} produced no output`);
  }
  return elapsedMs;
}

