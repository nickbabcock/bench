import { timeit } from "@/lib/timeit";
import brWritePath from "@/wasm/br_write_bg.wasm";
import brReadPath from "@/wasm/br_read_bg.wasm";
import minizPath from "@/wasm/miniz_bg.wasm";
import zstdReadPath from "@/wasm/zstd_read_bg.wasm";
import zstdWritePath from "@/wasm/zstd_write_bg.wasm";
import lz4Path from "@/wasm/lz4_bg.wasm";
import zunePath from "@/wasm/zune_bg.wasm";
import libdeflatePath from "@/wasm/libdeflate_bg.wasm";
import zlibrsPath from "@/wasm/zlib_rs_bg.wasm";
import { transfer } from "comlink";
import type { GzipOptions } from "fflate";
import type Pako from "pako";
import { load } from "@/lib/wasm";

const miniz = load({
  js: () => import("@/wasm/miniz"),
  wasm: minizPath,
});

const zstdRead = load({
  js: () => import("@/wasm/zstd_read"),
  wasm: zstdReadPath,
});

const zstdWrite = load({
  js: () => import("@/wasm/zstd_write"),
  wasm: zstdWritePath,
});

const lz4 = load({
  js: () => import("@/wasm/lz4"),
  wasm: lz4Path,
});

const brRead = load({
  js: () => import("@/wasm/br_read"),
  wasm: brReadPath,
});

const brWrite = load({
  js: () => import("@/wasm/br_write"),
  wasm: brWritePath,
});

const zune = load({
  js: () => import("@/wasm/zune"),
  wasm: zunePath,
});

const libdeflate = load({
  js: () => import("@/wasm/libdeflate"),
  wasm: libdeflatePath,
});

const zlibrs = load({
  js: () => import("@/wasm/zlib_rs"),
  wasm: zlibrsPath,
});

export async function nativeCompress(data: Uint8Array) {
  const [response, elapsedMs] = await timeit(() => {
    const cs = new CompressionStream("gzip");
    const pipe = new Blob([data]).stream().pipeThrough(cs);
    return new Response(pipe).arrayBuffer();
  });
  const out = new Uint8Array(response);
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function nativeDecompress(data: Uint8Array) {
  const [response, elapsedMs] = await timeit(() => {
    const cs = new DecompressionStream("gzip");
    const pipe = new Blob([data]).stream().pipeThrough(cs);
    return new Response(pipe).arrayBuffer();
  });
  const out = new Uint8Array(response);
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function pakoCompress(
  data: Uint8Array,
  level: Pako.DeflateFunctionOptions["level"],
) {
  const pako = await import("pako");
  const [out, elapsedMs] = await timeit(() => pako.deflate(data, { level }));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function pakoDecompress(data: Uint8Array) {
  const pako = await import("pako");
  const [, elapsedMs] = await timeit(() => pako.inflate(data));
  return { elapsedMs };
}

export async function fflateCompress(
  data: Uint8Array,
  level: GzipOptions["level"],
) {
  const { gzipSync } = await import("fflate");
  const [out, elapsedMs] = await timeit(() => gzipSync(data, { level }));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function fflateDecompress(data: Uint8Array) {
  const { gunzipSync } = await import("fflate");
  const [out, elapsedMs] = await timeit(() => gunzipSync(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function minizCompress(data: Uint8Array, level: number) {
  const mod = await miniz();
  const [out, elapsedMs] = await timeit(() => mod.compress(data, level));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function minizDecompress(data: Uint8Array) {
  const mod = await miniz();
  const [out, elapsedMs] = await timeit(() => mod.decompress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function zstdCompress(data: Uint8Array, level: number) {
  const mod = await zstdWrite();
  const [out, elapsedMs] = await timeit(() => mod.compress(data, level));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function zstdDecompress(data: Uint8Array) {
  const mod = await zstdRead();
  const [out, elapsedMs] = await timeit(() => mod.decompress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function lz4Compress(data: Uint8Array) {
  const mod = await lz4();
  const [out, elapsedMs] = await timeit(() => mod.compress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function lz4Decompress(data: Uint8Array) {
  const mod = await lz4();
  const [out, elapsedMs] = await timeit(() => mod.decompress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function brotliCompress(data: Uint8Array, level: number) {
  const mod = await brWrite();
  const [out, elapsedMs] = await timeit(() => mod.compress(data, level));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function brotliDecompress(data: Uint8Array) {
  const mod = await brRead();
  const [out, elapsedMs] = await timeit(() => mod.decompress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function twiddleCompressed(data: Uint8Array) {
  const mod = await miniz();
  const [out, elapsedMs] = await timeit(() => mod.twiddle_compressed(data));
  return { out, elapsedMs };
}

export async function twiddleUncompressed(data: Uint8Array) {
  const mod = await miniz();
  const [out, elapsedMs] = await timeit(() => mod.twiddle_uncompressed(data));
  return { out, elapsedMs };
}

export async function zuneDecompress(data: Uint8Array) {
  const mod = await zune();
  const [out, elapsedMs] = await timeit(() => mod.decompress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function libdeflateCompress(data: Uint8Array, level: number) {
  const mod = await libdeflate();
  const [out, elapsedMs] = await timeit(() => mod.compress(data, level));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function libdeflateDecompress(data: Uint8Array) {
  const mod = await libdeflate();
  const [out, elapsedMs] = await timeit(() => mod.decompress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function zlibrsCompress(data: Uint8Array, level: number) {
  const mod = await zlibrs();
  const [out, elapsedMs] = await timeit(() => mod.compress_bench(data, level));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function zlibrsDecompress(data: Uint8Array) {
  const mod = await zlibrs();
  const [out, elapsedMs] = await timeit(() => mod.decompress_bench(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}
