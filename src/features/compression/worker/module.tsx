import { timeit } from "@/lib/timeit";
import brWritePath from "../../../../packages/br-write/pkg/br_write_bg.wasm";
import brReadPath from "../../../../packages/br-read/pkg/br_read_bg.wasm";
import minizPath from "../../../../packages/miniz/pkg/miniz_bg.wasm";
import zstdPath from "../../../../packages/zstd/pkg/zstd_bg.wasm";
import lz4Path from "../../../../packages/lz4/pkg/lz4_bg.wasm";
import { transfer } from "comlink";
import type { GzipOptions } from "fflate";
import type Pako from "pako";

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
  const mod = await import("../../../../packages/miniz/pkg/miniz");
  await mod.default(minizPath);
  const [out, elapsedMs] = await timeit(() => mod.compress(data, level));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function minizDecompress(data: Uint8Array) {
  const mod = await import("../../../../packages/miniz/pkg/miniz");
  await mod.default(minizPath);
  const [out, elapsedMs] = await timeit(() => mod.decompress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function zstdCompress(data: Uint8Array, level: number) {
  const mod = await import("../../../../packages/zstd/pkg/zstd");
  await mod.default(zstdPath);
  const [out, elapsedMs] = await timeit(() => mod.compress(data, level));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function zstdDecompress(data: Uint8Array) {
  const mod = await import("../../../../packages/zstd/pkg/zstd");
  await mod.default(zstdPath);
  const [out, elapsedMs] = await timeit(() => mod.decompress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function lz4Compress(data: Uint8Array) {
  const mod = await import("../../../../packages/lz4/pkg/lz4");
  await mod.default(lz4Path);
  const [out, elapsedMs] = await timeit(() => mod.compress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function lz4Decompress(data: Uint8Array) {
  const mod = await import("../../../../packages/lz4/pkg/lz4");
  await mod.default(lz4Path);
  const [out, elapsedMs] = await timeit(() => mod.decompress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function brotliCompress(data: Uint8Array, level: number) {
  const mod = await import("../../../../packages/br-write/pkg/br_write");
  await mod.default(brWritePath);
  const [out, elapsedMs] = await timeit(() => mod.compress(data, level));
  return transfer({ out, elapsedMs }, [out.buffer]);
}

export async function brotliDecompress(data: Uint8Array) {
  const mod = await import("../../../../packages/br-read/pkg/br_read");
  await mod.default(brReadPath);
  const [out, elapsedMs] = await timeit(() => mod.decompress(data));
  return transfer({ out, elapsedMs }, [out.buffer]);
}
