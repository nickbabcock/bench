import { timeit } from "@/lib/timeit";
import brWritePath from "../../../../packages/br-write/pkg/br_write_bg.wasm";
import brReadPath from "../../../../packages/br-read/pkg/br_read_bg.wasm";
import minizPath from "../../../../packages/miniz/pkg/miniz_bg.wasm";
import zstdReadPath from "../../../../packages/zstd-read/pkg/zstd_read_bg.wasm";
import zstdWritePath from "../../../../packages/zstd-write/pkg/zstd_write_bg.wasm";
import lz4Path from "../../../../packages/lz4/pkg/lz4_bg.wasm";
import zunePath from "../../../../packages/zune/pkg/zune_bg.wasm";
import { transfer } from "comlink";
import type { GzipOptions } from "fflate";
import type Pako from "pako";
import { load } from "@/lib/wasm";

const miniz = load({
  js: () => import("../../../../packages/miniz/pkg/miniz"),
  wasm: minizPath,
});

const zstdRead = load({
  js: () => import("../../../../packages/zstd-read/pkg/zstd_read"),
  wasm: zstdReadPath,
});

const zstdWrite = load({
  js: () => import("../../../../packages/zstd-write/pkg/zstd_write"),
  wasm: zstdWritePath,
});

const lz4 = load({
  js: () => import("../../../../packages/lz4/pkg/lz4"),
  wasm: lz4Path,
});

const brRead = load({
  js: () => import("../../../../packages/br-read/pkg/br_read"),
  wasm: brReadPath,
});

const brWrite = load({
  js: () => import("../../../../packages/br-write/pkg/br_write"),
  wasm: brWritePath,
});

const zune = load({
  js: () => import("../../../../packages/zune/pkg/zune"),
  wasm: zunePath,
});

export async function nativeCompress(data: Uint8Array) {
  const [response, elapsedMs] = await timeit(() => {
    const cs = new (self as any).CompressionStream("gzip");
    const pipe = new Blob([data]).stream().pipeThrough(cs);
    return new Response(pipe).arrayBuffer();
  });
  const out = new Uint8Array(response);
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function nativeDecompress(data: Uint8Array) {
  const [response, elapsedMs] = await timeit(() => {
    const cs = new (self as any).DecompressionStream("gzip");
    const pipe = new Blob([data]).stream().pipeThrough(cs);
    return new Response(pipe).arrayBuffer();
  });
  const out = new Uint8Array(response);
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function pakoCompress(
  data: Uint8Array,
  level: Pako.DeflateFunctionOptions["level"]
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
  level: GzipOptions["level"]
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
