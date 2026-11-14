/**
 * Editions: the provenance of every reference measurement.
 *
 * An edition is one dated reference release of a benchmark (its `id`, for
 * example "2026-11-08"). Each file under src/data/editions/ is one
 * *capture* within it: one benchmark, one machine, one browser, optionally
 * one input, and one of `repeat.of` independent repeats:
 *
 *   src/data/editions/<bench>/<edition-id>/<machine>/<browser>[-<input>].json          repeat 1
 *   src/data/editions/<bench>/<edition-id>/<machine>/<browser>[-<input>].repeat-2.json repeat 2, …
 *
 * The machine is part of the key, like the engine: CPU architecture can
 * change an effect's size or direction (wasm SIMD lowers differently on
 * x86-64 and arm64), so captures from different machines are never pooled.
 *
 * Repeat 1 is the dataset a page shows. Further repeats exist for the
 * reproduction gate (src/lib/findings.ts): a headline claim must hold in
 * two independent captures.
 *
 * Who fills what:
 * - the browser (src/routes/capture.tsx): `browser`, `method`, `params`,
 *   `raw`, and from build time (build-info.ts) `toolchain`, `commit`,
 *   `artifacts` and `corpus`;
 * - the capture script (scripts/capture.mjs): `machine` (CPU model, power
 *   state, OS), which a browser can't know, the browser's exact version
 *   from the driver, and the edition id and repeat.
 *
 * This file has no imports, so Node can load it directly (type stripping)
 * to validate captures. Keep the shape stable: bump EDITION_SCHEMA on any
 * breaking change.
 */

export const EDITION_SCHEMA = 1;

export type BenchId = "compression" | "allocation" | "memory64" | "build" | "locks";
export const benchIds: readonly BenchId[] = ["compression", "allocation", "memory64", "build", "locks"];

/** Browsers the capture script drives. */
export type BrowserId = "chrome" | "firefox" | "safari";

/** A machine id: lowercase letters, digits and dashes, ending in the arch ("m4pro-arm64"). */
export const MACHINE_ID = /^[a-z0-9]+(?:-[a-z0-9_]+)*$/;

export type Machine = {
  /**
   * Stable id used in paths and keys: "m4pro-arm64", "ryzen9-7950x-x86_64".
   * Chosen by the capture script (`--machine`), defaulting to a slug of
   * the CPU model plus the arch.
   */
  id: string;
  /** "Apple M4 Pro" (`sysctl -n machdep.cpu.brand_string`, `lscpu`); "unknown" from a browser alone. */
  cpuModel: string;
  /** "arm64", "x86_64". */
  arch: string;
  /** Logical cores. */
  cores: number | null;
  /** "macOS 26.1 (25B78)", "Ubuntu 26.04 LTS". */
  os: string;
  /** x86 CPU feature flags that bear on wasm SIMD lowering (avx2, sse4_1, …); empty on arm64. */
  cpuFlags: string[];
  power: {
    /** "AC" or "battery": `pmset -g batt` on macOS, /sys/class/power_supply on Linux. */
    source: "AC" | "battery" | "unknown";
    /** Low Power Mode, from `pmset -g`; null when unknown. */
    lowPowerMode: boolean | null;
  };
  /**
   * 1-, 5- and 15-minute load averages when the capture started. The script
   * refuses to capture above 1.5 unless told the result is provisional.
   */
  loadAverage?: [number, number, number];
};

export type BrowserInfo = {
  id: BrowserId | "other";
  /** "Chrome", "Firefox", "Safari". */
  name: string;
  /** Full version, "156.0.7444.60". */
  version: string;
  userAgent: string;
  headless: boolean;
  /** Required for every reference capture (COOP/COEP served). */
  crossOriginIsolated: boolean;
  /** Median non-zero step of performance.now() inside a worker, in ms. */
  timerResolutionMs: number;
  /** Smallest non-zero step observed, in ms. */
  timerMinStepMs: number;
};

export type Toolchain = {
  /** "rustc 1.99.1 (58cf8f9c3 2026-10-13)". */
  rustc: string;
  /** The nightly that builds the Memory64 pair, "nightly-2026-11-01". */
  rustcNightly: string;
  /** "wasi-sdk-29": compiles the C codecs (zstd, libdeflate). */
  wasiSdk: string;
  /** "wasm-opt version 133 (version_133)". */
  binaryen: string;
  /** wasm-bindgen crate and CLI version. */
  wasmBindgen: string;
  /** Release profile and post-processing every shipped module uses. */
  profile: { optLevel: string; lto: string; codegenUnits: string; targetFeatures: string[]; wasmOpt: string };
  /** Measured libraries and their resolved versions ("zstd": "0.14.3 (libzstd 1.5.7)"). */
  crates: Record<string, string>;
};

/** A wasm module the capture loaded; `name` is its path under src/wasm. */
export type Artifact = { name: string; sha256: string; bytes: number };

/** A corpus file the capture read: its pinned SHA-256 and uncompressed size. */
export type CorpusFile = { id: string; sha256: string; bytes: number };

export type Method = {
  /** Timed rounds per row (n). */
  samples: number;
  /** Each timed sample is a batch lasting at least this long, divided by its size. */
  batchTargetMs: number;
  /** Untimed warm-up before sampling, per row. */
  warmup: { minMs: number; minRounds: number; maxRounds: number };
  /**
   * How a round orders the things it compares: "rotate" starts each round
   * one later; "alternate" swaps a pair's order every round.
   */
  order: "rotate" | "alternate";
  /** Whether rounds pair across variants (ratios are taken round by round). */
  paired: boolean;
};

export type Edition<Raw = unknown, Params = Record<string, unknown>> = {
  schema: typeof EDITION_SCHEMA;
  /** The release this capture belongs to: "2026-11-08". */
  id: string;
  bench: BenchId;
  /** The reference input ("dickens"), or null when the capture spans several or none. */
  input: string | null;
  /** Which independent capture this is: 1 of 2, 2 of 2. */
  repeat: { index: number; of: number };
  /** ISO 8601, when sampling started and ended. */
  capturedAt: string;
  endedAt: string;
  machine: Machine;
  browser: BrowserInfo;
  toolchain: Toolchain;
  /** The git commit built; dirty when the tree had uncommitted changes. */
  commit: { sha: string; dirty: boolean | null };
  artifacts: Artifact[];
  corpus: CorpusFile[];
  method: Method;
  /** Benchmark-specific parameters (codec settings, sizes, levels). */
  params: Params;
  /** Every per-round sample, as the benchmark's session recorded it. */
  raw: Raw;
  /**
   * How this capture compared with the other repeat when it was written
   * (scripts/capture.mjs). Informational: pages recompute it from `raw`
   * (`repeatDrift` below), so older captures without it work the same.
   */
  repeatDrift?: Drift;
  /**
   * Build only: subject subsets recaptured after the original capture and
   * merged in (`scripts/capture.mjs --bench build --subjects a,b`). Each
   * subject's rounds are self-contained, so its rows were replaced
   * outright; `capturedAt`, `browser` and `commit` above stay the
   * original capture's, and each merge records its own here. The
   * artifacts list carries the merged subjects' modules as they ran.
   */
  merged?: MergedCapture[];
};

/** One subject subset merged into a build capture. */
export type MergedCapture = {
  subjects: string[];
  capturedAt: string;
  endedAt: string;
  /** The browser's full version for this merge. */
  browserVersion: string;
  commit: { sha: string; dirty: boolean | null };
  /** Drift of the merged subjects' series against the other repeat, when it existed. */
  repeatDrift?: Drift;
};

/** Path of one capture under src/data/editions/. */
export const capturePath = (e: Pick<Edition, "bench" | "id" | "input" | "repeat"> & { machine: { id: string }; browser: { id: string } }) =>
  `${e.bench}/${e.id}/${e.machine.id}/${e.browser.id}${e.input ? `-${e.input}` : ""}${e.repeat.index > 1 ? `.repeat-${e.repeat.index}` : ""}.json`;

// ---------------------------------------------------------------------------
// Writing: compact, still reviewable JSON.
// ---------------------------------------------------------------------------

/** A value that fits this many characters, or an array of plain values, is written on one line. */
const LINE = 200;

/**
 * An edition as JSON text for its file: every array of plain values (the
 * per-round samples) and every value that fits on one line is written on
 * one line; larger objects and arrays break one entry per line, indented
 * by one space. Parsing it gives back exactly the same value as
 * `JSON.stringify(edition)`, in a fraction of the lines.
 */
export function formatEdition(edition: unknown): string {
  const write = (v: unknown, indent: string): string => {
    const one = JSON.stringify(v);
    const plainArray = Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");
    if (v === null || typeof v !== "object" || plainArray || one.length <= LINE) {
      return one;
    }
    const inner = `${indent} `;
    if (Array.isArray(v)) {
      // As JSON.stringify does, an undefined array entry is written null.
      return `[\n${v.map((x) => inner + write(x === undefined ? null : x, inner)).join(",\n")}\n${indent}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${write(x, inner)}`).join(",\n")}\n${indent}}`;
  };
  return `${write(edition, "")}\n`;
}

// ---------------------------------------------------------------------------
// Validation: structural, plus per-benchmark checks on `raw`.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isNums = (x: unknown): x is number[] => Array.isArray(x) && x.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
const SHA = /^[0-9a-f]{64}$/;

/** Problems with a capture, as messages; empty when it is a valid Edition. */
export function validateEdition(x: unknown): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, msg: string) => {
    if (!ok) {
      errors.push(msg);
    }
    return ok;
  };
  if (!need(isObj(x), "not an object")) {
    return errors;
  }
  const e = x as Obj;
  need(e.schema === EDITION_SCHEMA, `schema must be ${EDITION_SCHEMA}`);
  need(typeof e.id === "string" && /^\d{4}-\d{2}-\d{2}/.test(e.id), "id must start with a date");
  need(benchIds.includes(e.bench as BenchId), "bench unknown");
  need(e.input === null || typeof e.input === "string", "input must be a string or null");
  const r = e.repeat as Obj | undefined;
  need(isObj(r) && Number.isInteger(r.index) && Number.isInteger(r.of) && (r.index as number) >= 1 && (r.index as number) <= (r.of as number), "repeat must be {index, of}");
  for (const k of ["capturedAt", "endedAt"]) {
    need(typeof e[k] === "string" && !Number.isNaN(Date.parse(e[k] as string)), `${k} must be an ISO date`);
  }
  const m = e.machine as Obj | undefined;
  if (need(isObj(m), "machine missing") && isObj(m)) {
    need(typeof m.id === "string" && MACHINE_ID.test(m.id), "machine.id must be a slug like m4pro-arm64");
    for (const k of ["cpuModel", "arch", "os"]) {
      need(typeof m[k] === "string" && (m[k] as string).length > 0, `machine.${k} missing`);
    }
    need(Array.isArray(m.cpuFlags), "machine.cpuFlags missing");
    need(isObj(m.power) && ["AC", "battery", "unknown"].includes((m.power as Obj).source as string), "machine.power.source invalid");
  }
  const b = e.browser as Obj | undefined;
  if (need(isObj(b), "browser missing") && isObj(b)) {
    for (const k of ["name", "version", "userAgent"]) {
      need(typeof b[k] === "string", `browser.${k} missing`);
    }
    need(typeof b.crossOriginIsolated === "boolean", "browser.crossOriginIsolated missing");
    need(typeof b.timerResolutionMs === "number" && (b.timerResolutionMs as number) > 0, "browser.timerResolutionMs invalid");
  }
  const t = e.toolchain as Obj | undefined;
  if (need(isObj(t), "toolchain missing") && isObj(t)) {
    for (const k of ["rustc", "wasiSdk", "binaryen", "wasmBindgen"]) {
      need(typeof t[k] === "string", `toolchain.${k} missing`);
    }
    need(isObj(t.crates), "toolchain.crates missing");
  }
  const c = e.commit as Obj | undefined;
  need(isObj(c) && typeof c.sha === "string" && (c.dirty === null || typeof c.dirty === "boolean"), "commit must be {sha, dirty}");
  need(
    Array.isArray(e.artifacts) && e.artifacts.length > 0 && e.artifacts.every((a) => isObj(a) && typeof a.name === "string" && SHA.test(a.sha256 as string) && Number.isInteger(a.bytes)),
    "artifacts must be a non-empty list of {name, sha256, bytes}",
  );
  need(
    Array.isArray(e.corpus) && e.corpus.every((f) => isObj(f) && typeof f.id === "string" && SHA.test(f.sha256 as string) && Number.isInteger(f.bytes)),
    "corpus must be a list of {id, sha256, bytes}",
  );
  const method = e.method as Obj | undefined;
  if (need(isObj(method), "method missing") && isObj(method)) {
    need(Number.isInteger(method.samples) && (method.samples as number) >= 1, "method.samples invalid");
    need(typeof method.batchTargetMs === "number", "method.batchTargetMs missing");
    need(isObj(method.warmup), "method.warmup missing");
    need(method.order === "rotate" || method.order === "alternate", "method.order invalid");
  }
  need(isObj(e.params), "params missing");
  if (e.merged !== undefined) {
    need(
      e.bench === "build" &&
        Array.isArray(e.merged) &&
        e.merged.every(
          (mc) =>
            isObj(mc) &&
            Array.isArray(mc.subjects) &&
            mc.subjects.length > 0 &&
            mc.subjects.every((k) => typeof k === "string") &&
            typeof mc.capturedAt === "string" &&
            !Number.isNaN(Date.parse(mc.capturedAt)) &&
            typeof mc.endedAt === "string" &&
            typeof mc.browserVersion === "string" &&
            isObj(mc.commit) &&
            typeof mc.commit.sha === "string",
        ),
      "merged must be a build-only list of {subjects, capturedAt, endedAt, browserVersion, commit}",
    );
    const subjectsOf = (raw: unknown) => new Set(Array.isArray(raw) ? raw.map((row) => (isObj(row) ? row.subject : undefined)) : []);
    const present = subjectsOf(e.raw);
    need(
      !Array.isArray(e.merged) || e.merged.every((mc) => !isObj(mc) || !Array.isArray(mc.subjects) || mc.subjects.every((k) => present.has(k))),
      "every merged subject must have rows in raw",
    );
  }
  if (errors.length === 0) {
    errors.push(...validateRaw(e.bench as BenchId, e.raw, (method as Obj).samples as number));
  }
  return errors;
}

/** Every row has exactly `n` positive, finite samples per series. */
function validateRaw(bench: BenchId, raw: unknown, n: number): string[] {
  const errors: string[] = [];
  const series = (label: string, xs: unknown) => {
    if (!isNums(xs) || xs.length !== n) {
      errors.push(`${label}: expected ${n} positive samples`);
    }
  };
  switch (bench) {
    case "compression": {
      const run = raw as Obj;
      if (!isObj(run) || run.status !== "done" || !Array.isArray(run.configs) || run.configs.length === 0) {
        return ["raw must be a finished compression run with configs"];
      }
      for (const [i, cfg] of (run.configs as unknown[]).entries()) {
        if (!isObj(cfg)) {
          errors.push(`raw.configs[${i}] is not an object`);
          continue;
        }
        const id = isObj(cfg.spec) ? (cfg.spec.id ?? "?") : "?";
        series(`raw.configs[${id}].decodeMs`, cfg.decodeMs);
        // Decode-only configurations record an empty encodeMs.
        if (!Array.isArray(cfg.encodeMs)) {
          errors.push(`raw.configs[${id}].encodeMs missing`);
        } else if (cfg.encodeMs.length > 0) {
          series(`raw.configs[${id}].encodeMs`, cfg.encodeMs);
        }
        if (cfg.roundTrip !== true) {
          errors.push(`raw.configs[${id}] did not round-trip`);
        }
      }
      break;
    }
    case "allocation": {
      const run = raw as Obj;
      if (!isObj(run) || !isObj(run.results)) {
        return ["raw must be an allocation run"];
      }
      for (const [a, res] of Object.entries(run.results as Record<string, unknown>)) {
        series(`raw.results[${a}].samples`, isObj(res) ? res.samples : undefined);
      }
      break;
    }
    case "memory64":
    case "build": {
      const rows = (bench === "memory64" ? [raw] : raw) as Obj[];
      if (!Array.isArray(rows) || rows.length === 0) {
        return ["raw must hold at least one row"];
      }
      for (const [i, row] of rows.entries()) {
        if (!isObj(row) || !isObj(row.samples)) {
          errors.push(`raw[${i}] has no samples`);
          continue;
        }
        for (const [v, xs] of Object.entries(row.samples as Record<string, unknown>)) {
          series(`raw[${i}].samples[${v}]`, xs);
        }
        if (row.checksumsMatch !== true) {
          errors.push(`raw[${i}] checksums differ between variants`);
        }
      }
      break;
    }
    case "locks": {
      const run = raw as Obj;
      if (!isObj(run) || !Array.isArray(run.variants) || !run.variants.includes("abort") || !isObj(run.samples)) {
        return ["raw must be a locks run that measured the abort build"];
      }
      const builds = ["abort", "unwind", "atomics"];
      if (!run.variants.every((v) => builds.includes(v as string))) {
        errors.push(`raw.variants must be among ${builds.join(", ")}`);
      }
      if (!isObj(run.skipped) || !isObj(run.flags) || !isObj(run.calls) || !Number.isInteger(run.iterations)) {
        errors.push("raw must record skipped, flags, calls and iterations");
      }
      // Every build has the default build's workloads, so the page can read any cell.
      const expected = Object.keys(((run.samples as Obj).abort as Obj | undefined) ?? {}).sort().join();
      for (const v of run.variants as string[]) {
        const byWorkload = (run.samples as Obj)[v];
        if (!isObj(byWorkload) || Object.keys(byWorkload).length === 0) {
          errors.push(`raw.samples[${v}] missing`);
          continue;
        }
        if (Object.keys(byWorkload).sort().join() !== expected) {
          errors.push(`raw.samples[${v}] has other workloads than raw.samples[abort]`);
        }
        for (const [w, xs] of Object.entries(byWorkload)) {
          series(`raw.samples[${v}][${w}]`, xs);
        }
      }
      if (run.checksumsMatch !== true) {
        errors.push("raw checksums differ between builds");
      }
      break;
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Repeat drift: whether two independent captures of one setting agree.
// scripts/capture.mjs applies the same rule when it writes a capture.
// ---------------------------------------------------------------------------

/**
 * `factor`: geometric mean of this capture's medians over the other's,
 * matched series by series (above 1: this one took longer). `outliers`:
 * the share of series whose medians differ by more than 1.5×, either way.
 */
export type Drift = { factor: number; outliers: number };

/** Two repeats disagree when the overall factor leaves 1/1.25–1.25 … */
export const MAX_DRIFT = 1.25;
/** … or more than 5% of series moved by more than 1.5×. */
export const MAX_DRIFT_OUTLIERS = 0.05;
const OUTLIER_RATIO = 1.5;

/**
 * The keys whose arrays hold timings: allocation and memory64/build
 * `samples`, compression `encodeMs` and `decodeMs`, and `ms`. Only arrays
 * under one of these count. Metadata arrays (Allocation's document sizes,
 * Compression's `zstdParams`) are identical in every capture, so counting
 * them would pull the factor toward 1 and let a uniform slowdown through.
 */
export const TIMING_KEYS: ReadonlySet<string> = new Set(["samples", "encodeMs", "decodeMs", "ms"]);

/**
 * The median (upper, for even n) of every timing array (n ≥ 5, under a
 * `TIMING_KEYS` key) in a raw capture, keyed by JSON path.
 */
export function sampleMedians(raw: unknown, path = "", out = new Map<string, number>(), timing = false): Map<string, number> {
  if (Array.isArray(raw)) {
    if (raw.length >= 5 && raw.every((x) => typeof x === "number")) {
      if (timing) {
        const sorted = [...(raw as number[])].sort((a, b) => a - b);
        out.set(path, sorted[sorted.length >> 1]);
      }
    } else {
      raw.forEach((x, i) => sampleMedians(x, `${path}[${i}]`, out, timing));
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      sampleMedians(v, `${path}.${k}`, out, timing || TIMING_KEYS.has(k));
    }
  }
  return out;
}

/**
 * How capture `a` ran against capture `b` of the same setting. A slowed
 * state can hit only part of a capture, so both the overall factor and
 * the share of series that moved count.
 */
export function repeatDrift(a: unknown, b: unknown): Drift {
  const ma = sampleMedians(a);
  const mb = sampleMedians(b);
  const logs: number[] = [];
  for (const [k, v] of ma) {
    const w = mb.get(k);
    if (v > 0 && w !== undefined && w > 0) {
      logs.push(Math.log(v / w));
    }
  }
  if (!logs.length) {
    return { factor: 1, outliers: 0 };
  }
  const outliers = logs.filter((x) => Math.abs(x) > Math.log(OUTLIER_RATIO)).length / logs.length;
  return { factor: Math.exp(logs.reduce((s, x) => s + x, 0) / logs.length), outliers };
}

/** A build row's identity across captures: its subject and input. */
const rowKey = (r: { subject?: unknown; input?: unknown }) => `${String(r.subject)}\u0000${JSON.stringify(r.input ?? null)}`;

/**
 * Build captures only: the rows of a raw capture for some subjects, so a
 * merge (`MergedCapture`) checks drift on the series it replaced. Sorted
 * by subject and input: `repeatDrift` matches series by position, and a
 * subset run's row order follows `--subjects`, not the base capture's.
 */
export const rowsFor = (raw: unknown, subjects: readonly string[]) =>
  Array.isArray(raw)
    ? raw.filter((r): r is Obj => isObj(r) && subjects.includes(r.subject as string)).sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0))
    : raw;

/** Whether a drift means the two captures disagree (one ran in a slowed state). */
export const driftFails = ({ factor, outliers }: Drift) => factor > MAX_DRIFT || factor < 1 / MAX_DRIFT || outliers > MAX_DRIFT_OUTLIERS;

// ---------------------------------------------------------------------------
// Merging a subject subset into a build capture (scripts/capture.mjs --subjects)
// ---------------------------------------------------------------------------

type BuildRowLike = { subject: string; input?: unknown; id?: unknown; run?: unknown };
type BuildCapture = Edition<BuildRowLike[], { subjects?: Record<string, { crate?: string }>; captured?: string[] } & Record<string, unknown>>;

/**
 * Merge a build capture of some subjects into the existing capture of the
 * same edition, machine, browser and repeat. Each subject's rounds are
 * self-contained, so its rows are replaced outright, in place by subject
 * and input (rows with no counterpart go last); the modules those subjects load
 * (`variants/<crate>/…`) replace theirs in `artifacts`; and `merged`
 * records when, in which browser version and at which commit. Everything
 * else stays the original capture's.
 */
export function mergeSubjects(base: BuildCapture, part: BuildCapture, subjects: readonly string[]): BuildCapture {
  if (base.bench !== "build" || part.bench !== "build") {
    throw new Error("--subjects merges build captures only");
  }
  if (base.method.samples !== part.method.samples) {
    throw new Error(`samples differ: the capture has ${base.method.samples} per row, this run ${part.method.samples}; pass --samples ${base.method.samples}`);
  }
  const fresh = part.raw.filter((r) => subjects.includes(r.subject));
  const missing = subjects.filter((k) => !fresh.some((r) => r.subject === k));
  if (missing.length) {
    throw new Error(`no rows for ${missing.join(", ")}`);
  }
  // A row is one subject on one input: replace each in place, keeping the run
  // order. The replacement keeps the base row's `id` and `run`: the part's
  // own numbering counts only its subset, so it would collide with the base's.
  const queue = new Map<string, BuildRowLike[]>();
  for (const r of fresh) {
    queue.set(rowKey(r), [...(queue.get(rowKey(r)) ?? []), r]);
  }
  const raw: BuildRowLike[] = base.raw.flatMap((r) => {
    if (!subjects.includes(r.subject)) {
      return [r];
    }
    const next = queue.get(rowKey(r))?.shift();
    if (!next) {
      return [];
    }
    const kept: BuildRowLike = Object.assign({}, next);
    if ("id" in r) {
      kept.id = r.id;
    }
    if ("run" in r) {
      kept.run = r.run;
    }
    return [kept];
  });
  raw.push(...[...queue.values()].flat());
  const crateOf = (k: string) => part.params.subjects?.[k]?.crate ?? base.params.subjects?.[k]?.crate;
  const crates = subjects.map(crateOf).filter((c): c is string => typeof c === "string");
  const ownModule = (name: string) => crates.some((c) => name.startsWith(`variants/${c}/`));
  const artifacts = [...base.artifacts.filter((a) => !ownModule(a.name)), ...part.artifacts.filter((a) => ownModule(a.name))].sort((a, b) => a.name.localeCompare(b.name));
  const corpus = [...new Map([...base.corpus, ...part.corpus].map((f) => [f.id, f])).values()];
  const earlier = (base.merged ?? []).map((m) => ({ ...m, subjects: m.subjects.filter((k) => !subjects.includes(k)) })).filter((m) => m.subjects.length > 0);
  return {
    ...base,
    params: { ...base.params, subjects: { ...base.params.subjects, ...part.params.subjects } },
    artifacts,
    corpus,
    raw,
    merged: [
      ...earlier,
      {
        subjects: [...subjects],
        capturedAt: part.capturedAt,
        endedAt: part.endedAt,
        browserVersion: part.browser.version,
        commit: part.commit,
        ...(part.repeatDrift ? { repeatDrift: part.repeatDrift } : {}),
      },
    ],
  };
}
