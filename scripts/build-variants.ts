/**
 * Build-settings variants: the same crates compiled with SIMD off and on,
 * each post-processed with wasm-opt off, -Os (the site default) and -O3.
 *
 *   src/wasm/variants/<crate>/<simd>-<opt>/
 *     <crate>.js, <crate>_bg.wasm   wasm-bindgen glue and module
 *     manifest.json                 sizes, SIMD op count, exact flags
 *
 * Rust stays at the release profile (opt-level 3, fat LTO, one codegen
 * unit) for every variant; only the two settings under study change. The
 * scalar build reuses the site's own target dir and flags, so its -Os
 * variant is byte-identical to the module the other pages load.
 *
 * Run with `mise run build:variants` (needs the mise toolchain on PATH).
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/** Crates under study. The harness maps workloads onto these. */
const crates = [
  { pkg: "zstd-read", name: "zstd_read" },
  { pkg: "zlib-rs@0.1.0", name: "zlib_rs" },
  { pkg: "lz4", name: "lz4" },
  { pkg: "br-write", name: "br_write" },
  { pkg: "alloc", name: "alloc" },
] as const;

type Simd = "off" | "on";
type Opt = "none" | "Os" | "O3";
const opts: readonly Opt[] = ["none", "Os", "O3"];

const TARGET = "wasm32-unknown-unknown";
const OUT = "src/wasm/variants";
const STAGE = "target/variants-stage";
const GZIP_LEVEL = 9;
// wasm-opt drops the debug name section anyway; dropping it here too keeps
// the no-wasm-opt variant's size about optimization, not about debug names.
const bindgenArgs = ["--target", "web", "--remove-name-section"];
const BROTLI_QUALITY = 11;

/** Everything that differs between the scalar and SIMD builds. */
const builds: Record<Simd, { targetDir: string; env: Record<string, string> }> = {
  // Same env and target dir as `build:wasm`, so this is a no-op after it.
  off: { targetDir: "target", env: {} },
  on: {
    targetDir: "target/simd",
    env: {
      // Rust code: every crate compiled in this build, including generic std
      // code monomorphized into them. Non-generic std (dlmalloc, fmt, …)
      // ships prebuilt without simd128 and stays scalar.
      RUSTFLAGS: "-C target-feature=+simd128",
      // C code compiled by cc-rs (zstd-sys); cc-rs does not translate Rust
      // target features into clang flags, so pass it explicitly.
      CFLAGS_wasm32_unknown_unknown: "-msimd128",
    },
  },
};

const win = process.platform === "win32";
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 30, env: { ...process.env, ...env }, shell: win })
    .toString()
    .trim();

/** SIMD instructions (v128 and lane-typed ops), from the text format. */
function simdOps(wasm: string) {
  const text = run("wasm-dis", [wasm]);
  const ops = text.match(/\((?:v128|[if](?:8x16|16x8|32x4|64x2))\.[\w.]+/g) ?? [];
  const byOp: Record<string, number> = {};
  for (const op of ops) {
    const name = op.slice(1);
    byOp[name] = (byOp[name] ?? 0) + 1;
  }
  const top = Object.entries(byOp)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  // Functions whose body contains at least one SIMD instruction.
  let functions = 0;
  for (const body of text.split(/\n \(func /).slice(1)) {
    if (/\((?:v128|[if](?:8x16|16x8|32x4|64x2))\./.test(body)) {
      functions++;
    }
  }
  return { instructions: ops.length, functions, top: Object.fromEntries(top) };
}

function sizes(wasm: string) {
  const bytes = readFileSync(wasm);
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: GZIP_LEVEL }).length,
    brotli: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
    }).length,
  };
}

const started = performance.now();
const rustc = run("rustc", ["--version"]);
const wasmOptVersion = run("wasm-opt", ["--version"]);
const wasmBindgenVersion = run("wasm-bindgen", ["--version"]);
const packages = crates.flatMap((c) => ["-p", c.pkg]);

rmSync(OUT, { recursive: true, force: true });
rmSync(STAGE, { recursive: true, force: true });

for (const simd of ["off", "on"] as const) {
  const { targetDir, env } = builds[simd];
  const cargoArgs = ["build", "--target", TARGET, "--release", ...packages, "--target-dir", targetDir];
  const t0 = performance.now();
  run("cargo", cargoArgs, env);
  console.log(`cargo (simd ${simd}): ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  for (const crate of crates) {
    const stage = join(STAGE, crate.name, simd);
    run("wasm-bindgen", [...bindgenArgs, "--out-dir", stage, join(targetDir, TARGET, "release", `${crate.name}.wasm`)]);
    const bgWasm = `${crate.name}_bg.wasm`;
    for (const opt of opts) {
      const dir = join(OUT, crate.name, `${simd}-${opt}`);
      mkdirSync(dir, { recursive: true });
      cpSync(stage, dir, { recursive: true });
      const wasmOptArgs = opt === "none" ? [] : [`-${opt}`];
      if (opt !== "none") {
        run("wasm-opt", [...wasmOptArgs, join(stage, bgWasm), "-o", join(dir, bgWasm)]);
      }
      const manifest = {
        crate: crate.name,
        package: crate.pkg,
        simd,
        opt,
        wasm: bgWasm,
        bytes: sizes(join(dir, bgWasm)),
        compression: { gzipLevel: GZIP_LEVEL, brotliQuality: BROTLI_QUALITY },
        simdOps: simdOps(join(dir, bgWasm)),
        flags: {
          cargo: `cargo ${cargoArgs.join(" ")}`,
          env,
          profile: "release: opt-level 3 (default), lto = true, codegen-units = 1",
          wasmBindgen: `wasm-bindgen ${bindgenArgs.join(" ")}`,
          wasmOpt: opt === "none" ? null : `wasm-opt ${wasmOptArgs.join(" ")}`,
        },
        toolchain: { rustc, wasmBindgen: wasmBindgenVersion, wasmOpt: wasmOptVersion },
      };
      writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(
        `${crate.name.padEnd(10)} ${simd.padEnd(3)} ${opt.padEnd(4)} ${String(manifest.bytes.raw).padStart(8)} B  gz ${String(manifest.bytes.gzip).padStart(7)}  br ${String(manifest.bytes.brotli).padStart(7)}  simd ops ${manifest.simdOps.instructions} in ${manifest.simdOps.functions} fns`,
      );
    }
  }
}

// Sanity check: the scalar -Os variant should be the module the site ships.
for (const crate of crates) {
  const site = join("src/wasm", `${crate.name}_bg.wasm`);
  const variant = join(OUT, crate.name, "off-Os", `${crate.name}_bg.wasm`);
  if (existsSync(site) && !readFileSync(site).equals(readFileSync(variant))) {
    console.warn(`warning: ${variant} differs from the site's ${site}; rerun build:wasm?`);
  }
}

rmSync(STAGE, { recursive: true, force: true });
console.log(`build:variants done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
