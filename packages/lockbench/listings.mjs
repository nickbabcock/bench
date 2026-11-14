// The WebAssembly text of each lock kernel (the `k_*` functions in
// src/lib.rs), in each of the three builds, as wasm-bindgen ships them. Run
// by `mise run build:locks`; the RefCell against Mutex page reads
// src/wasm/locks-listings.json.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const builds = { abort: "locks_abort_bg.wasm", unwind: "locks_unwind_bg.wasm", atomics: "locks_atomics_bg.wasm" };
/** Older versions can not read the exnref instructions of the panic=unwind build. */
const MIN_MINOR = 220;

/**
 * The wasm-tools that mise pins. Find it by its install directory, because
 * an older wasm-tools (for example from `cargo install`) can come first on
 * the PATH.
 */
function wasmTools() {
  const candidates = [];
  try {
    const dir = execFileSync("mise", ["where", "github:bytecodealliance/wasm-tools"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    candidates.push(join(dir, process.platform === "win32" ? "wasm-tools.exe" : "wasm-tools"));
  } catch {
    // mise is not on the PATH: use the PATH only.
  }
  candidates.push("wasm-tools");
  for (const bin of candidates) {
    if (bin !== "wasm-tools" && !existsSync(bin)) {
      continue;
    }
    let version;
    try {
      version = execFileSync(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      // Not on the PATH.
      continue;
    }
    const minor = Number(/^wasm-tools 1\.(\d+)\./.exec(version)?.[1] ?? 0);
    if (minor >= MIN_MINOR) {
      return { bin, version };
    }
    console.warn(`skipped ${bin}: ${version} is older than 1.${MIN_MINOR}`);
  }
  throw new Error(`No wasm-tools 1.${MIN_MINOR} or later. Run \`mise install\`.`);
}

/**
 * Remove the crate hashes ("lockbench[f59a04ab9c98f576]") and the
 * "lockbench::" prefix. A hash comes directly after a crate name, and it has
 * up to 16 hex digits: the demangler drops leading zeros
 * ("lockbench[6373eae3de2d88c]"). A slice type ("<[f32]>") does not come
 * after a name, so it stays. A name that is one identifier after the
 * prefix loses its quotes too (`$k_plain`); a longer one keeps them
 * (`$"State::record"`).
 */
const tidy = (line) =>
  line
    .replace(/(\w)\[[0-9a-f]{1,16}\]/g, "$1")
    .replace(/\$"lockbench::([^"]+)"/g, (_, name) => (/^\w+$/.test(name) ? `$${name}` : `$"${name}"`))
    .replace(/\$lockbench::(\w+)/g, "$$$1");
/** A kernel's `(func …)` line, with or without the hash and the quotes. */
const KERNEL = /^ {2}\(func \$"?lockbench(?:\[[0-9a-f]{1,16}\])?::(k_\w+)"?[ )]/;

/** Every top-level `(func …)` of a kernel, by kernel name, as text with the module indent removed. */
function kernels(text) {
  const out = {};
  let name;
  let lines = [];
  for (const line of text.split("\n")) {
    if (/^ {2}\(/.test(line) || line === ")") {
      if (name) {
        out[name] = lines.join("\n");
      }
      name = KERNEL.exec(line)?.[1];
      lines = [];
      if (name) {
        // "(func $"…::k_mutex_lock" (;67;) (type 21) (param i32 i64)": keep the name and the signature.
        lines.push(tidy(line.slice(2)).replace(/ \(;\d+;\)/, "").replace(/ \(type \d+\)/, ""));
      }
      continue;
    }
    if (name) {
      lines.push(tidy(line.slice(2)));
    }
  }
  return out;
}

const { bin, version } = wasmTools();
const texts = Object.fromEntries(
  Object.entries(builds).map(([build, file]) => [build, execFileSync(bin, ["print", join("src/wasm", file)], { maxBuffer: 64 << 20 }).toString()]),
);
const listings = Object.fromEntries(Object.entries(texts).map(([build, text]) => [build, kernels(text)]));
const names = Object.keys(listings.abort).sort();
if (names.length === 0) {
  const funcs = texts.abort.split("\n").filter((l) => /^ {2}\(func /.test(l) && /lockbench/.test(l));
  throw new Error(`No k_* kernel in the default build. Its lockbench functions:\n${funcs.slice(0, 20).join("\n")}`);
}
for (const [build, k] of Object.entries(listings)) {
  if (Object.keys(k).sort().join() !== names.join()) {
    throw new Error(`The ${build} build has kernels ${Object.keys(k).sort().join(", ")}; the default build has ${names.join(", ")}`);
  }
}
writeFileSync("src/wasm/locks-listings.json", `${JSON.stringify({ printer: version, builds: listings }, null, 2)}\n`);
console.log(`${names.length} kernels in ${Object.keys(builds).length} builds: ${names.join(", ")}`);
