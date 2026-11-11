import type { Allocator } from "./allocators";

/** Download size of one allocation module, as shipped (after wasm-opt). */
export type ModuleSize = { file: string; raw: number; gzip: number; brotli: number };
export type ModuleSizes = { gzipLevel: number; brotliQuality: number; modules: Record<Allocator, ModuleSize> };

/**
 * Written at build time by packages/alloc-workload/sizes.mjs (`mise run
 * build:wasm`). A glob, so a checkout that hasn't built the modules yet
 * still compiles; the page then says the sizes aren't available.
 */
const files = import.meta.glob<ModuleSizes>("/src/wasm/alloc-sizes.json", { eager: true, import: "default" });
export const moduleSizes: ModuleSizes | undefined = Object.values(files)[0];
