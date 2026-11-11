/**
 * Reproducibility metadata, derived at build time from the lockfiles and
 * build configuration rather than typed by hand: every measured library's
 * resolved version, the Rust toolchain, profile and target features, and
 * the wasm-opt level. Exposed to the app as `__BUILD_INFO__`.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

/** Registry packages from Cargo.lock: name → version (workspace crates skipped). */
function cargoVersions(lock: string) {
  const out: Record<string, string> = {};
  for (const block of lock.split("[[package]]")) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (name && version && /^source = "registry/m.test(block)) {
      out[name] = version;
    }
  }
  return out;
}

function npmVersion(lock: string, name: string) {
  try {
    return (JSON.parse(lock).packages?.[`node_modules/${name}`]?.version as string) ?? "unknown";
  } catch {
    return "unknown";
  }
}

function tool(cmd: string) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return undefined;
  }
}

/**
 * Every wasm module the site ships, by path under src/wasm (for example
 * "zstd_read_bg.wasm", "variants/zlib_rs/on-Os/zlib_rs_bg.wasm"), with its
 * SHA-256 and size. Hashed from the files Vite bundles, so they match the
 * bytes served.
 */
function wasmArtifacts(root = "src/wasm") {
  const out: { name: string; sha256: string; bytes: number }[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isDirectory()) {
        walk(path);
      } else if (e.name.endsWith(".wasm")) {
        const bytes = readFileSync(path);
        out.push({
          name: relative(root, path).split("\\").join("/"),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
        });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Gzip level for code sizes: the common server default. */
const CODE_GZIP_LEVEL = 6;

/**
 * Gzipped bytes of the code the Compression page ships per library,
 * computed here so they are the same in every browser: each wasm module
 * under src/wasm (by its artifact name), and the published minified JS
 * builds of pako (inflate-only and deflate-only entries) and fflate (one
 * bundle; it has no inflate-only build). Missing files are left out.
 */
function codeSizes() {
  const gz = (path: string) => {
    try {
      return gzipSync(readFileSync(path), { level: CODE_GZIP_LEVEL }).length;
    } catch {
      return undefined;
    }
  };
  const files: Record<string, number> = {};
  for (const a of wasmArtifacts()) {
    const n = gz(join("src/wasm", a.name));
    if (n !== undefined) {
      files[a.name] = n;
    }
  }
  const js: Record<string, string> = {
    "pako/inflate": "node_modules/pako/dist/browser/pako_inflate.esm.min.mjs",
    "pako/deflate": "node_modules/pako/dist/browser/pako_deflate.esm.min.mjs",
    fflate: "node_modules/fflate/umd/index.js",
  };
  for (const [name, path] of Object.entries(js)) {
    const n = gz(path);
    if (n !== undefined) {
      files[name] = n;
    }
  }
  return { gzipLevel: CODE_GZIP_LEVEL, files };
}

/** The pinned Silesia subset from xtask (name, uncompressed bytes, SHA-256). */
function corpusFiles() {
  const xtask = read("xtask/src/main.rs");
  const subset = /const SUBSET[^=]*=\s*&\[([\s\S]*?)\];/.exec(xtask)?.[1] ?? "";
  return [...subset.matchAll(/\(\s*"([^"]+)",\s*([\d_]+),\s*"([0-9a-f]{64})",?\s*\)/g)].map((m) => ({
    id: m[1],
    sha256: m[3],
    bytes: Number(m[2].replace(/_/g, "")),
  }));
}

/** The commit built, and whether the working tree had uncommitted changes. */
function commit() {
  const sha = tool("git rev-parse HEAD") ?? "unknown";
  // The capture script writes to src/data/editions. These files do not make the build dirty.
  const status = tool("git status --porcelain -- . ':!src/data/editions'");
  return { sha, dirty: status === undefined ? null : status.length > 0 };
}

export function buildInfo() {
  const crates = cargoVersions(read("Cargo.lock"));
  const npm = read("package-lock.json");
  const cargoToml = read("Cargo.toml");
  const release = /\[profile\.release\]([\s\S]*?)(\n\[|$)/.exec(cargoToml)?.[1] ?? "";
  const mise = read(".config/mise.toml");
  const cargoConfig = read(".cargo/config.toml");
  const rustflags = `${/rustflags\s*=\s*\[([^\]]*)\]/.exec(cargoConfig)?.[1] ?? ""} ${process.env.RUSTFLAGS ?? ""}`;
  const features = [...rustflags.matchAll(/\+([\w-]+)/g)].map((m) => m[1]);
  const zstdSys = crates["zstd-sys"] ?? "";
  return {
    rustc: tool("rustc --version") ?? `rustc ${/"rust" = \[\s*\{ version = "([^"]+)"/.exec(mise)?.[1] ?? "unknown"}`,
    rustcNightly: /rust_nightly = "([^"]+)"/.exec(mise)?.[1] ?? "unknown",
    optLevel: /opt-level\s*=\s*"?(\w+)"?/.exec(release)?.[1] ?? "3",
    lto: /lto\s*=\s*(\w+|"[^"]+")/.exec(release)?.[1]?.replace(/"/g, "") ?? "false",
    codegenUnits: /codegen-units\s*=\s*(\d+)/.exec(release)?.[1] ?? "16",
    targetFeatures: features.length ? features : ["none (no simd128)"],
    wasmOpt: /wasm-opt (-O\w*)/.exec(mise)?.[1] ?? "none",
    wasmBindgen: crates["wasm-bindgen"] ?? "unknown",
    /** Toolchain pins from .config/mise.toml (what CI and captures build with). */
    toolchain: {
      wasiSdk: /"github:WebAssembly\/wasi-sdk" = \{ version = "([^"]+)"/.exec(mise)?.[1] ?? "unknown",
      binaryen: tool("wasm-opt --version") ?? /"github:WebAssembly\/binaryen" = \{ version = "([^"]+)"/.exec(mise)?.[1] ?? "unknown",
      wasmBindgenCli: /"github:rustwasm\/wasm-bindgen" = \{ version = "([^"]+)"/.exec(mise)?.[1] ?? "unknown",
      node: process.version,
    },
    commit: commit(),
    builtAt: new Date().toISOString(),
    artifacts: wasmArtifacts(),
    codeSizes: codeSizes(),
    corpus: corpusFiles(),
    libraries: {
      lz4_flex: crates.lz4_flex,
      zstd: `${crates.zstd} (libzstd ${/\+zstd\.([\d.]+)/.exec(zstdSys)?.[1] ?? "?"})`,
      miniz_oxide: crates.miniz_oxide,
      "zune-inflate": crates["zune-inflate"],
      libdeflater: `${crates.libdeflater} (libdeflate-sys ${crates["libdeflate-sys"]})`,
      "zlib-rs": `${crates["zlib-rs"]} (via flate2 ${crates.flate2})`,
      brotli: `${crates.brotli} (decoder brotli-decompressor ${crates["brotli-decompressor"]})`,
      pako: npmVersion(npm, "pako"),
      fflate: npmVersion(npm, "fflate"),
      bumpalo: crates.bumpalo,
      "bump-scope": crates["bump-scope"],
      talc: crates.talc,
      bevy_ecs: crates.bevy_ecs,
    } as Record<string, string>,
  };
}

export type BuildInfo = ReturnType<typeof buildInfo>;
