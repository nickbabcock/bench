#!/usr/bin/env node
/**
 * Reference capture: build the site, serve it cross-origin isolated, and run
 * every benchmark in real browsers through the unlinked /capture route,
 * which uses exactly the visitors' harness and session code. Each capture is
 * written as an Edition (src/lib/edition.ts) to
 *
 *   src/data/editions/<bench>/<edition>/<machine>/<browser>[-<input>][.repeat-N].json
 *
 * Usage (from the repo root, with the mise toolchain):
 *   mise run capture -- [options]
 *   node scripts/capture.mjs [options]
 *
 * Options:
 *   --machine <id>       machine id in paths ("m4pro-arm64"); default: CPU model + arch
 *   --edition <id>       edition id; default: today's date (YYYY-MM-DD)
 *   --repeat <n>         independent captures of everything (default 2, for the reproduction gate)
 *   --only-repeat <k>    take only repeat k of n (to redo one repeat)
 *   --browsers <list>    chrome,firefox,safari (default: all that are available)
 *   --bench <list>       compression,allocation,memory64,build (default: all)
 *   --inputs <list>      compression inputs (default: dickens,xml,x-ray,samba)
 *   --subjects <list>    build only: recapture these subjects (zstd-decode,alloc,…) and merge
 *                        their rows into the existing capture of the same edition, machine,
 *                        browser and repeat. Their rows and modules are replaced, the merge is
 *                        recorded in `merged`, and drift is checked on their series alone.
 *   --samples <n>        override every benchmark's sample count (for smoke tests)
 *   --headed             show Chrome and Firefox windows (default: headless)
 *   --skip-build         reuse .output/public
 *   --out <dir>          write captures elsewhere (default src/data/editions)
 *   --force              redo captures whose files already exist (default: skip them, so a run resumes)
 *   --allow-busy         capture even when the 1-minute load average is over 1.5 (the result is provisional)
 *   --timeout <min>      give up on one capture after this long (default 45)
 *
 * Environment overrides: CHROME_BIN, FIREFOX_BIN, GECKODRIVER, PLAYWRIGHT_VERSION.
 *
 * Runs on macOS and Linux. Safari runs only on macOS, and only once
 * "Allow Remote Automation" is enabled (Safari ▸ Settings ▸ Developer);
 * otherwise it is skipped with a message.
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, loadavg, platform } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { capturePath, driftFails, formatEdition, MACHINE_ID, mergeSubjects, repeatDrift, rowsFor, validateEdition } from "../src/lib/edition.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let OUT = join(ROOT, "src/data/editions");
const PUBLIC = join(ROOT, ".output/public");
const ALL_BENCHES = ["compression", "allocation", "memory64", "build"];
const ALL_INPUTS = ["dickens", "xml", "x-ray", "samba"];
/** Samples per row: compression n ≥ 10, build n = 15; allocation and memory64 raised from 5 to 20 (each takes seconds). */
const SAMPLES = { compression: 10, allocation: 20, memory64: 20, build: 15 };
/** Per-capture limit; a capture that runs longer is reported and skipped (`--timeout <min>`). */
let CAPTURE_TIMEOUT_MS = 45 * 60_000;
/** If the page does not start a capture in this time, the capture fails. */
const START_TIMEOUT_MS = 30_000;
/** A WebDriver call that takes longer than this is treated as a hung browser. */
const DRIVER_CALL_TIMEOUT_MS = 2 * 60_000;
/** Busier than this (1-minute load average), the machine isn't idle enough to capture. */
const MAX_LOAD = 1.5;
const PLAYWRIGHT_VERSION = process.env.PLAYWRIGHT_VERSION ?? "1.64.1";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { repeat: 2, headed: false, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) {
        throw new Error(`${a} needs a value`);
      }
      return v;
    };
    switch (a) {
      case "--machine": opts.machine = value(); break;
      case "--edition": opts.edition = value(); break;
      case "--repeat": opts.repeat = Number(value()); break;
      case "--only-repeat": opts.onlyRepeat = Number(value()); break;
      case "--browsers": opts.browsers = value().split(","); break;
      case "--bench": opts.bench = value().split(","); break;
      case "--inputs": opts.inputs = value().split(","); break;
      case "--subjects": opts.subjects = value().split(",").filter(Boolean); break;
      case "--samples": opts.samples = Number(value()); break;
      case "--headed": opts.headed = true; break;
      case "--skip-build": opts.skipBuild = true; break;
      case "--force": opts.force = true; break;
      case "--allow-busy": opts.allowBusy = true; break;
      case "--timeout": CAPTURE_TIMEOUT_MS = Number(value()) * 60_000; break;
      case "--out": OUT = resolve(value()); break;
      case "--": break;
      case "-h":
      case "--help":
        console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option ${a}`);
    }
  }
  if (!Number.isInteger(opts.repeat) || opts.repeat < 1) {
    throw new Error("--repeat must be a positive integer");
  }
  if (opts.onlyRepeat !== undefined && !(Number.isInteger(opts.onlyRepeat) && opts.onlyRepeat >= 1 && opts.onlyRepeat <= opts.repeat)) {
    throw new Error(`--only-repeat must be an integer from 1 to ${opts.repeat} (the --repeat count)`);
  }
  if (opts.subjects && (opts.bench ?? []).join(",") !== "build") {
    throw new Error("--subjects needs --bench build");
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Host facts: what a browser can't know
// ---------------------------------------------------------------------------

const sh = (cmd, args = []) => {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return undefined;
  }
};
const which = (cmd) => sh("which", [cmd]) || undefined;

/** x86 flags that bear on how wasm SIMD lowers. */
const RELEVANT_FLAGS = ["sse2", "ssse3", "sse4_1", "sse4_2", "popcnt", "avx", "avx2", "bmi1", "bmi2", "lzcnt", "fma", "avx512f", "avx512bw", "avx512vl", "avx512vbmi"];

function hostFacts() {
  const arch = sh("uname", ["-m"]) ?? process.arch;
  const cores = cpus().length;
  if (platform() === "darwin") {
    const cpuModel = sh("sysctl", ["-n", "machdep.cpu.brand_string"]) ?? cpus()[0]?.model ?? "unknown";
    const features = `${sh("sysctl", ["-n", "machdep.cpu.features"]) ?? ""} ${sh("sysctl", ["-n", "machdep.cpu.leaf7_features"]) ?? ""}`.toLowerCase().replace(/\./g, "_");
    const batt = sh("pmset", ["-g", "batt"]) ?? "";
    const pm = sh("pmset", ["-g"]) ?? "";
    const lowPower = /(?:lowpowermode|powermode)\s+(\d)/.exec(pm);
    return {
      cpuModel,
      arch,
      cores,
      os: `macOS ${sh("sw_vers", ["-productVersion"]) ?? "?"} (${sh("sw_vers", ["-buildVersion"]) ?? "?"})`,
      cpuFlags: RELEVANT_FLAGS.filter((f) => features.split(/\s+/).includes(f)),
      power: {
        source: /'AC Power'/.test(batt) ? "AC" : /'Battery Power'/.test(batt) ? "battery" : "unknown",
        // powermode 1 is Low Power Mode on Apple silicon (2 is High Power).
        lowPowerMode: lowPower ? lowPower[1] === "1" : null,
      },
    };
  }
  // Linux
  const lscpu = sh("lscpu") ?? "";
  const cpuinfo = existsSync("/proc/cpuinfo") ? readFileSync("/proc/cpuinfo", "utf8") : "";
  const cpuModel = /^Model name:\s*(.+)$/m.exec(lscpu)?.[1]?.trim() ?? /^model name\s*:\s*(.+)$/m.exec(cpuinfo)?.[1]?.trim() ?? cpus()[0]?.model ?? "unknown";
  const flags = (/^flags\s*:\s*(.+)$/m.exec(cpuinfo)?.[1] ?? /^Flags:\s*(.+)$/m.exec(lscpu)?.[1] ?? "").split(/\s+/);
  const osRelease = existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : "";
  const os = /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(osRelease)?.[1] ?? `Linux ${sh("uname", ["-r"]) ?? ""}`;
  // AC when any mains supply is online, or when there is no battery at all (a desktop).
  let source = "unknown";
  const supplies = "/sys/class/power_supply";
  if (existsSync(supplies)) {
    const entries = readdirSync(supplies).map((name) => {
      const read = (f) => (existsSync(join(supplies, name, f)) ? readFileSync(join(supplies, name, f), "utf8").trim() : "");
      return { type: read("type"), online: read("online") };
    });
    const mains = entries.filter((e) => e.type === "Mains" || e.type === "USB");
    const battery = entries.some((e) => e.type === "Battery");
    source = mains.some((e) => e.online === "1") || !battery ? "AC" : mains.length ? "battery" : "unknown";
  }
  const profile = sh("powerprofilesctl", ["get"]);
  return {
    cpuModel,
    arch,
    cores,
    os,
    cpuFlags: RELEVANT_FLAGS.filter((f) => flags.includes(f)),
    power: { source, lowPowerMode: profile ? profile === "power-saver" : null },
  };
}

/** "Apple M4 Pro" + arm64 → "m4-pro-arm64"; "AMD Ryzen 9 7950X 16-Core Processor" → "ryzen-9-7950x-x86_64". */
function machineSlug(cpuModel, arch) {
  const core = cpuModel
    .toLowerCase()
    .replace(/\((r|tm)\)/g, "")
    .replace(/@.*$/, "")
    .replace(/\b(apple|amd|intel|core|processor|cpu|\d+-core)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${core || "cpu"}-${arch.toLowerCase().replace(/[^a-z0-9_]+/g, "")}`;
}

/** HEAD and whether the working tree has changes, for the console banner only. Captures record the commit that the built page reports. */
function gitCommit() {
  const sha = sh("git", ["-C", ROOT, "rev-parse", "HEAD"]) ?? "unknown";
  // The capture output in src/data/editions does not make the tree dirty.
  const status = sh("git", ["-C", ROOT, "status", "--porcelain", "--", ".", ":!src/data/editions"]);
  return { sha, dirty: status === undefined ? null : status.length > 0 };
}

// ---------------------------------------------------------------------------
// Static server: COOP/COEP (cross-origin isolation) and Range requests
// ---------------------------------------------------------------------------

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".zip": "application/zip",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serve(root) {
  const server = createServer((req, res) => {
    let file = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) {
      file = join(file, "index.html");
    }
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const body = readFileSync(file);
    const headers = {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${body.length}`, "Content-Length": end - start + 1 });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": body.length });
    res.end(body);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

// ---------------------------------------------------------------------------
// Browsers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Playwright via npx (no project dependency): resolve its package once. */
let playwright;
async function loadPlaywright() {
  if (playwright) {
    return playwright;
  }
  try {
    playwright = await import("playwright");
    return playwright;
  } catch {
    // Not installed locally; fetch a pinned version into the npx cache.
  }
  const bin = sh("npx", ["-y", "-p", `playwright@${PLAYWRIGHT_VERSION}`, "-c", "command -v playwright"]);
  if (!bin) {
    throw new Error(`Couldn't get playwright@${PLAYWRIGHT_VERSION} via npx`);
  }
  const pkg = dirname(realpathSync(bin));
  playwright = await import(pathToFileURL(join(pkg, "index.mjs")).href);
  return playwright;
}

/** Poll window.benchCapture until done or error; return the edition JSON string. */
async function waitForCapture(evaluate, label) {
  const startDeadline = Date.now() + START_TIMEOUT_MS;
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  let last = "no status (the /capture page never started)";
  let started = false;
  while (Date.now() < deadline) {
    await sleep(2000);
    let timer;
    const hung = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: the browser did not answer within ${DRIVER_CALL_TIMEOUT_MS / 1000} s (hung?)`)), DRIVER_CALL_TIMEOUT_MS);
    });
    let state;
    try {
      state = await Promise.race([evaluate(), hung]);
    } finally {
      clearTimeout(timer);
    }
    if (state) {
      last = state.status;
    }
    if (state?.status === "done") {
      return state.json;
    }
    if (state?.status === "error") {
      throw new Error(`${label}: ${state.error}`);
    }
    if (state?.status === "running") {
      started = true;
    } else if (!started && Date.now() > startDeadline) {
      throw new Error(`${label}: the capture did not start within ${START_TIMEOUT_MS / 1000} s; last status: ${last}`);
    }
  }
  throw new Error(`${label}: timed out after ${CAPTURE_TIMEOUT_MS / 60_000} min; last status: ${last}`);
}

const READ_STATE = `const s = window.benchCapture; return s ? { status: s.status, error: s.error, json: s.status === "done" ? JSON.stringify(s.edition) : undefined } : null;`;

const chrome = {
  id: "chrome",
  available() {
    if (process.env.CHROME_BIN) {
      return existsSync(process.env.CHROME_BIN) ? true : "CHROME_BIN does not exist";
    }
    const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    return (platform() === "darwin" ? existsSync(mac) : Boolean(which("google-chrome") || which("google-chrome-stable"))) || "Google Chrome is not installed";
  },
  async open(headed) {
    const { chromium } = await loadPlaywright();
    // channel "chrome": the installed Google Chrome, not a bundled Chromium.
    // On Linux, fall back to google-chrome on PATH when it isn't in /opt/google/chrome.
    const linuxChrome = platform() === "linux" && !existsSync("/opt/google/chrome/chrome") ? (which("google-chrome") ?? which("google-chrome-stable")) : undefined;
    const executablePath = process.env.CHROME_BIN ?? linuxChrome;
    const browser = await chromium.launch({ ...(executablePath ? { executablePath } : { channel: "chrome" }), headless: !headed });
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error(`    [chrome] page error: ${e.message}`));
    return {
      version: browser.version(),
      run: async (url, label) => {
        await page.goto(url);
        return waitForCapture(() => page.evaluate(new Function(READ_STATE)), label);
      },
      close: () => browser.close(),
    };
  },
};

/** A minimal W3C WebDriver client (geckodriver, safaridriver). */
async function webdriver(command, args, capabilities, label) {
  const port = 4400 + Math.floor(Math.random() * 500);
  const driver = spawn(command, [...args, "--port", String(port)].filter(Boolean), { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  driver.stderr.on("data", (d) => (stderr += d));
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(DRIVER_CALL_TIMEOUT_MS),
    }).catch((e) => {
      throw new Error(e.name === "TimeoutError" ? `${label}: the driver did not answer ${method} ${path} within ${DRIVER_CALL_TIMEOUT_MS / 1000} s (browser hung?)` : `${label}: driver unreachable (${e.message})`);
    });
    const j = await r.json();
    if (j.value?.error) {
      throw new Error(`${j.value.error}: ${j.value.message}`);
    }
    return j.value;
  };
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/status`);
      break;
    } catch {
      await sleep(100);
    }
  }
  let session;
  try {
    session = await call("POST", "/session", { capabilities: { alwaysMatch: capabilities } });
  } catch (e) {
    driver.kill();
    throw new Error(`${label}: ${e.message}${stderr ? `\n${stderr.trim()}` : ""}`, { cause: e });
  }
  const sid = session.sessionId;
  return {
    version: session.capabilities.browserVersion,
    run: async (url, name) => {
      await call("POST", `/session/${sid}/url`, { url });
      return waitForCapture(() => call("POST", `/session/${sid}/execute/sync`, { script: READ_STATE, args: [] }), name);
    },
    close: async () => {
      await call("DELETE", `/session/${sid}`).catch(() => {});
      driver.kill();
    },
  };
}

function firefoxPaths() {
  const bin = process.env.FIREFOX_BIN ?? (platform() === "darwin" ? "/Applications/Firefox.app/Contents/MacOS/firefox" : which("firefox"));
  // Ubuntu's Firefox is a snap (/snap/bin/firefox, a link to /usr/bin/snap);
  // its own geckodriver knows the sandbox. A Mac without Firefox has no bin.
  const real = bin && existsSync(bin) ? realpathSync(bin) : "";
  const snap = Boolean(bin) && (bin.startsWith("/snap/") || real === "/usr/bin/snap" || real.includes("/snap/"));
  const driver = process.env.GECKODRIVER ?? (snap && existsSync("/snap/bin/geckodriver") ? "/snap/bin/geckodriver" : which("geckodriver"));
  return { bin, driver };
}

const firefox = {
  id: "firefox",
  available() {
    const { bin, driver } = firefoxPaths();
    if (!bin || !existsSync(bin)) {
      return "Firefox is not installed";
    }
    return driver ? true : "geckodriver is not on PATH (install it, or set GECKODRIVER)";
  },
  async open(headed) {
    const { bin, driver } = firefoxPaths();
    return webdriver(driver, [], { browserName: "firefox", "moz:firefoxOptions": { binary: bin, args: headed ? [] : ["-headless"] } }, "firefox");
  },
};

const safari = {
  id: "safari",
  available() {
    if (platform() !== "darwin") {
      return "Safari runs only on macOS";
    }
    return which("safaridriver") ? true : "safaridriver not found";
  },
  async open() {
    try {
      return await webdriver("safaridriver", [], { browserName: "safari" }, "safari");
    } catch (e) {
      if (/remote automation|Allow Remote Automation/i.test(e.message)) {
        throw Object.assign(new Error("Safari: enable Safari ▸ Settings ▸ Developer ▸ Allow Remote Automation (and run `safaridriver --enable` once)"), { skip: true });
      }
      throw e;
    }
  },
};

const BROWSERS = { chrome, firefox, safari };

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const started = Date.now();

// On macOS, keep the machine awake for the whole capture so it never naps.
if (platform() === "darwin") {
  spawn("caffeinate", ["-dimsu", "-w", String(process.pid)], { stdio: "ignore", detached: true }).unref();
}

/**
 * macOS gives a background app lower scheduling priority, and can put it on
 * the efficiency cores. Automated Safari otherwise ran some captures several
 * times slower than others, so it is kept frontmost while it measures.
 */
const keepFrontmost = (app) => {
  const activate = () => {
    try {
      execFileSync("osascript", ["-e", `tell application "${app}" to activate`], { stdio: "ignore" });
    } catch {
      // Not fatal: the cross-repeat check below still flags a slow capture.
    }
  };
  activate();
  const timer = setInterval(activate, 15_000);
  return () => clearInterval(timer);
};

const benches = opts.bench ?? ALL_BENCHES;
const inputs = opts.inputs ?? ALL_INPUTS;
for (const b of benches) {
  if (!ALL_BENCHES.includes(b)) {
    throw new Error(`Unknown benchmark ${b}`);
  }
}

const host = hostFacts();
const machineId = opts.machine ?? machineSlug(host.cpuModel, host.arch);
if (!MACHINE_ID.test(machineId)) {
  throw new Error(`--machine ${machineId}: use lowercase letters, digits, dashes and underscores`);
}
const commit = gitCommit();
const editionId = opts.edition ?? new Date().toLocaleDateString("en-CA");
console.log(`Machine ${machineId}: ${host.cpuModel}, ${host.arch}, ${host.cores} cores, ${host.os}, power ${host.power.source}${host.power.lowPowerMode ? " (Low Power Mode on)" : ""}`);
if (host.cpuFlags.length) {
  console.log(`  CPU flags: ${host.cpuFlags.join(" ")}`);
}
console.log(`Edition ${editionId}, commit ${commit.sha.slice(0, 12)}${commit.dirty ? " (dirty)" : ""}`);
if (commit.dirty) {
  console.warn("warning: the working tree has uncommitted changes; captures record dirty: true");
}
if (host.power.source === "battery") {
  console.warn("warning: on battery power; plug in for reference captures");
} else if (host.power.source !== "AC") {
  console.warn(`warning: power source is ${host.power.source}`);
}
if (host.power.lowPowerMode) {
  console.warn("warning: Low Power Mode is on; timings will be slower");
}
const load = loadavg()[0];
if (load > MAX_LOAD) {
  if (!opts.allowBusy) {
    console.error(`The 1-minute load average is ${load.toFixed(2)} (over ${MAX_LOAD}): close other work so the machine is idle, or pass --allow-busy for a provisional capture.`);
    process.exit(2);
  }
  console.warn(`warning: 1-minute load average is ${load.toFixed(2)}; captures are provisional (--allow-busy)`);
}

const browsers = [];
for (const id of opts.browsers ?? Object.keys(BROWSERS)) {
  const b = BROWSERS[id];
  if (!b) {
    throw new Error(`Unknown browser ${id}`);
  }
  const ok = b.available();
  if (ok === true) {
    browsers.push(b);
  } else {
    console.warn(`Skipping ${id}: ${ok}`);
  }
}
if (browsers.length === 0) {
  throw new Error("No browsers available");
}

if (!opts.skipBuild) {
  console.log("Building the site (npm run build)…");
  execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
}
if (!existsSync(join(PUBLIC, "capture/index.html")) && !existsSync(join(PUBLIC, "capture.html"))) {
  throw new Error("No /capture page in .output/public; build first");
}
if (!existsSync(join(PUBLIC, "corpus/silesia.zip"))) {
  throw new Error("public/corpus/silesia.zip is missing; run `mise run build:corpus`");
}

// Serve a snapshot, so a rebuild during a long capture can't change the
// files mid-run.
const SNAPSHOT = join(ROOT, ".output/capture-snapshot");
rmSync(SNAPSHOT, { recursive: true, force: true });
cpSync(PUBLIC, SNAPSHOT, { recursive: true });
const server = await serve(SNAPSHOT);
const origin = `http://127.0.0.1:${server.address().port}`;

/** Every capture, in run order: repeats outermost, browsers innermost, so drift spreads evenly. */
const plan = [];
for (let repeat = opts.onlyRepeat ?? 1; repeat <= (opts.onlyRepeat ?? opts.repeat); repeat++) {
  for (const bench of benches) {
    for (const input of bench === "compression" ? inputs : [null]) {
      for (const browser of browsers) {
        plan.push({ repeat, bench, input, browser });
      }
    }
  }
}

// Close the open browser on Ctrl-C or kill, so no headless browser outlives the run.
let session;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await session?.close().catch(() => {});
    server.close();
    process.exit(130);
  });
}

const skipped = new Set();
const written = [];
const failures = [];
for (const [i, { repeat, bench, input, browser }] of plan.entries()) {
  if (skipped.has(browser.id)) {
    continue;
  }
  const label = `${browser.id} ${bench}${input ? ` ${input}` : ""} (repeat ${repeat} of ${opts.repeat})`;
  const path = join(OUT, capturePath({ bench, id: editionId, input, repeat: { index: repeat, of: opts.repeat }, machine: { id: machineId }, browser: { id: browser.id } }));
  if (opts.subjects && !existsSync(path)) {
    console.log(`[${i + 1}/${plan.length}] ${label}: no capture to merge --subjects into, skipped`);
    failures.push(`${label}: no existing capture`);
    continue;
  }
  if (existsSync(path) && !opts.force && !opts.subjects) {
    console.log(`[${i + 1}/${plan.length}] ${label}: exists, skipped (--force to redo)`);
    continue;
  }
  const samples = opts.samples ?? SAMPLES[bench];
  const url = `${origin}/capture?bench=${bench}${input ? `&input=${input}` : ""}&samples=${samples}${opts.subjects ? `&subjects=${opts.subjects.join(",")}` : ""}`;
  const t0 = Date.now();
  process.stdout.write(`[${i + 1}/${plan.length}] ${label}… `);
  session = undefined;
  try {
    // A fresh browser per capture: no state carries between captures.
    const loadAverage = loadavg().map((x) => Math.round(x * 100) / 100);
    if (loadAverage[0] > MAX_LOAD) {
      console.warn(`(load ${loadAverage[0]}) `);
    }
    session = await browser.open(opts.headed);
    const release = platform() === "darwin" && browser.id === "safari" ? keepFrontmost("Safari") : () => {};
    let json;
    try {
      json = await session.run(url, label);
    } finally {
      release();
    }
    let edition = JSON.parse(json);
    edition.id = editionId;
    edition.repeat = { index: repeat, of: opts.repeat };
    edition.machine = { id: machineId, ...host, loadAverage };
    edition.browser = { ...edition.browser, id: browser.id, version: session.version ?? edition.browser.version, headless: browser.id === "safari" ? false : !opts.headed };
    const errors = validateEdition(edition);
    if (!edition.browser.crossOriginIsolated) {
      errors.push("not cross-origin isolated");
    }
    if (errors.length) {
      throw new Error(`invalid capture: ${errors.join("; ")}`);
    }
    const otherPath = join(OUT, capturePath({ bench, id: editionId, input, repeat: { index: repeat === 1 ? 2 : 1, of: opts.repeat }, machine: { id: machineId }, browser: { id: browser.id } }));
    const merging = opts.subjects;
    if (opts.repeat > 1 && existsSync(otherPath)) {
      // A merge checks only the series it replaces.
      const mine = merging ? rowsFor(edition.raw, merging) : edition.raw;
      const theirs = JSON.parse(readFileSync(otherPath, "utf8")).raw;
      const { factor, outliers } = repeatDrift(mine, merging ? rowsFor(theirs, merging) : theirs);
      edition.repeatDrift = { factor: Math.round(factor * 1000) / 1000, outliers: Math.round(outliers * 1000) / 1000 };
      if (driftFails({ factor, outliers })) {
        const what = `${factor.toFixed(2)}× the other repeat overall, ${(outliers * 100).toFixed(0)}% of series off by over 1.5×`;
        console.warn(`(${what}: one of the two is unstable) `);
        failures.push(`${label}: ${what}`);
      }
    }
    if (merging) {
      edition = mergeSubjects(JSON.parse(readFileSync(path, "utf8")), edition, merging);
      const mergeErrors = validateEdition(edition);
      if (mergeErrors.length) {
        throw new Error(`invalid merge: ${mergeErrors.join("; ")}`);
      }
    }
    mkdirSync(dirname(path), { recursive: true });
    const text = formatEdition(edition);
    writeFileSync(path, text);
    written.push({ path, bytes: text.length });
    console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s → ${path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path}`);
  } catch (e) {
    if (e.skip) {
      console.log("skipped");
      console.warn(`  ${e.message}`);
      skipped.add(browser.id);
    } else if (/does not support memory64/.test(e.message)) {
      console.log("not supported");
    } else {
      console.log("failed");
      console.error(`  ${e.message}`);
      failures.push(label);
    }
  } finally {
    await session?.close().catch(() => {});
  }
}
server.close();

const minutes = (Date.now() - started) / 60_000;
const total = written.reduce((s, w) => s + w.bytes, 0);
console.log(`\n${written.length} captures, ${(total / 1024).toFixed(0)} KiB, in ${minutes.toFixed(1)} min.`);
if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
