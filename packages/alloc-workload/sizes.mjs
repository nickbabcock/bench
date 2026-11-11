// Download sizes of the four allocation modules, as shipped (after
// wasm-opt): raw, gzip -9 and brotli quality 11, the same settings as
// scripts/build-variants.ts. Run by `mise run build:wasm`; the Allocation
// page reads src/wasm/alloc-sizes.json.
import { readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const GZIP_LEVEL = 9;
const BROTLI_QUALITY = 11;
const modules = {
  dlmalloc: "alloc_bg.wasm",
  talc: "alloc_talc_bg.wasm",
  bumpalo: "alloc_bumpalo_bg.wasm",
  "bump-scope": "alloc_bump_scope_bg.wasm",
};

const sizes = Object.fromEntries(
  Object.entries(modules).map(([allocator, file]) => {
    const bytes = readFileSync(`src/wasm/${file}`);
    return [
      allocator,
      {
        file,
        raw: bytes.length,
        gzip: gzipSync(bytes, { level: GZIP_LEVEL }).length,
        brotli: brotliCompressSync(bytes, {
          params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
        }).length,
      },
    ];
  }),
);
writeFileSync("src/wasm/alloc-sizes.json", `${JSON.stringify({ gzipLevel: GZIP_LEVEL, brotliQuality: BROTLI_QUALITY, modules: sizes }, null, 2)}\n`);
console.log(Object.entries(sizes).map(([a, s]) => `${a} ${s.raw} B raw, ${s.brotli} B brotli`).join("\n"));
