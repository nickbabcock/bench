import { useSyncExternalStore } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MIN_SAMPLE_MS, MIN_WARMUP_MS, MIN_WARMUP_ROUNDS, MAX_WARMUP_ROUNDS } from "@/lib/bench";
import { build } from "@/lib/build";
import { browserFacts, measureWorkerTimer } from "@/lib/context";
import { type BenchId, benchIds, type BrowserId, type Edition, EDITION_SCHEMA, type Method } from "@/lib/edition";
import { corpora, corpusInfo, type CorpusId } from "@/features/compression/corpora";
import { families, familyInfo, plannedConfigs, supportsCompressionStreams } from "@/features/compression/codecs";
import { startRun as startCompression, useCompressionSession } from "@/features/compression/session";
import { useCompressionUi } from "@/features/compression/store";
import { setSamples as setAllocationSamples, startRun as startAllocation, useAllocationSession } from "@/features/allocation/session";
import { FIXED_BATCHES as ALLOC_FIXED_BATCHES, INPUT as ALLOC_INPUT } from "@/features/allocation/harness";
import { allocators, BASELINE as ALLOC_BASELINE } from "@/features/allocation/allocators";
import { setSampleCount as setMemory64Samples, startRun as startMemory64, useMemory64Session } from "@/features/memory64/session";
import * as m64 from "@/features/memory64/harness";
import { supportsMemory64 } from "@/features/memory64/workloads";
import { planFor, startRun as startBuild, useBuildSession } from "@/features/build/session";
import { MAX_ROUNDS as LOCKS_MAX_ROUNDS, MIN_ROUNDS as LOCKS_MIN_ROUNDS, setSampleCount as setLocksSamples, startRun as startLocks, useLocksSession } from "@/features/locks/session";
import { ITERATIONS as LOCKS_ITERATIONS, variants as lockVariants, workloadIds as lockWorkloads } from "@/features/locks/workloads";
import { BUILD_CORPORA } from "@/features/build/input";
import { AA, BASELINE as BUILD_BASELINE, BROTLI_QUALITY, DEFLATE_LEVEL, type SubjectKey, subjectKeys, subjects, variantIds, ZSTD_LEVEL } from "@/features/build/subjects";

/**
 * Reference capture: runs one benchmark through exactly the visitors'
 * session and harness code, then exposes an Edition (src/lib/edition.ts)
 * on `window.benchCapture` for scripts/capture.mjs. Not linked from the site.
 *
 *   /capture?bench=compression&input=dickens&samples=10
 *   /capture?bench=build&samples=15
 *   /capture?bench=build&samples=15&subjects=zstd-decode,alloc   (a subset, merged by the script)
 *   /capture?bench=allocation   /capture?bench=memory64   /capture?bench=locks
 *
 * Host facts (CPU model, power, OS) and the edition id are filled in by the
 * script; here they are best-effort placeholders.
 */
export const Route = createFileRoute("/capture")({
  head: () => ({ meta: [{ title: "Capture · WASM Bench" }, { name: "robots", content: "noindex" }] }),
  component: Capture,
});

type CaptureState =
  | { status: "idle" | "running"; detail?: string }
  | { status: "done"; edition: Edition }
  | { status: "error"; error: string };

declare global {
  interface Window {
    benchCapture?: CaptureState;
  }
}

const DEFAULT_SAMPLES: Record<BenchId, number> = { compression: 10, allocation: 20, memory64: 20, build: 15, locks: 20 };

const rotateMethod = (samples: number, paired: boolean): Method => ({
  samples,
  batchTargetMs: MIN_SAMPLE_MS,
  warmup: { minMs: MIN_WARMUP_MS, minRounds: MIN_WARMUP_ROUNDS, maxRounds: MAX_WARMUP_ROUNDS },
  order: "rotate",
  paired,
});

/** Run one benchmark and return its method, params, raw data and input. */
async function runBench(bench: BenchId, input: CorpusId | null, samples: number, only: readonly SubjectKey[] | null) {
  switch (bench) {
    case "compression": {
      const id = input ?? "dickens";
      useCompressionSession.setState({ samples, source: { kind: "corpus", id } });
      useCompressionUi.getState().actions.setAll(true);
      const enabled = useCompressionUi.getState().enabled;
      await startCompression();
      const run = useCompressionSession.getState().runs[0];
      if (!run || run.status !== "done") {
        throw new Error(run?.error ?? `compression run ${run?.status ?? "missing"}`);
      }
      return {
        input: id,
        corpus: [id],
        method: rotateMethod(samples, false),
        params: {
          input: id,
          inputBytes: corpusInfo(id).bytes,
          configs: plannedConfigs(enabled, supportsCompressionStreams()).map((c) => c.id),
          throughput: "MB/s of uncompressed input; 1 MB = 10^6 bytes",
          codecs: Object.fromEntries(
            families.map((f) => [f, { name: familyInfo[f].name, format: familyInfo[f].format, container: familyInfo[f].container, runtime: familyInfo[f].runtime, levels: familyInfo[f].levels, settings: familyInfo[f].settings ?? null, decodesFrom: familyInfo[f].decodesFrom ?? null, enabled: enabled[f] }]),
          ),
        },
        raw: run,
      };
    }
    case "allocation": {
      setAllocationSamples(samples);
      await startAllocation();
      const s = useAllocationSession.getState();
      if (s.error || s.cancelled || !s.runs[0]) {
        throw new Error(s.error ?? "allocation run did not finish");
      }
      return {
        input: null,
        corpus: [ALLOC_INPUT],
        method: rotateMethod(samples, true),
        params: { input: ALLOC_INPUT, documents: s.runs[0].documents.sizes.length, fixedBatches: ALLOC_FIXED_BATCHES, allocators, baseline: ALLOC_BASELINE },
        raw: s.runs[0],
      };
    }
    case "memory64": {
      if (!supportsMemory64()) {
        throw new Error("This browser does not support memory64");
      }
      setMemory64Samples(samples);
      await startMemory64("editor");
      const s = useMemory64Session.getState();
      if (s.error || s.cancelled || !s.results[0]) {
        throw new Error(s.error ?? "memory64 run did not finish");
      }
      return {
        input: null,
        corpus: [],
        method: {
          samples,
          batchTargetMs: MIN_SAMPLE_MS,
          warmup: { minMs: m64.MIN_WARMUP_MS, minRounds: MIN_WARMUP_ROUNDS, maxRounds: MAX_WARMUP_ROUNDS },
          order: "alternate",
          paired: true,
        } satisfies Method,
        params: { workload: s.results[0].workload, ...s.results[0].params, frames: s.results[0].frames },
        raw: s.results[0],
      };
    }
    case "build": {
      useBuildSession.setState({ sampleCount: samples, results: [] });
      await startBuild(planFor(only ?? subjectKeys, BUILD_CORPORA));
      const s = useBuildSession.getState();
      if (s.error || s.cancelled || s.results.length === 0) {
        throw new Error(s.error ?? "build run did not finish");
      }
      return {
        input: null,
        corpus: [...BUILD_CORPORA],
        method: rotateMethod(samples, true),
        params: {
          baseline: BUILD_BASELINE,
          aa: AA,
          variants: variantIds,
          inputs: BUILD_CORPORA,
          subjects: Object.fromEntries(subjectKeys.map((k) => [k, subjects[k]])),
          // Present only for a subset capture, which scripts/capture.mjs merges into the full edition.
          ...(only ? { captured: only } : {}),
          zstdLevel: ZSTD_LEVEL,
          deflateLevel: DEFLATE_LEVEL,
          brotliQuality: BROTLI_QUALITY,
        },
        // Sessions prepend; store rows in the order they ran.
        raw: [...s.results].reverse(),
      };
    }
    case "locks": {
      if (!Number.isInteger(samples) || samples < LOCKS_MIN_ROUNDS || samples > LOCKS_MAX_ROUNDS) {
        throw new Error(`locks needs ${LOCKS_MIN_ROUNDS}–${LOCKS_MAX_ROUNDS} samples, not ${samples}`);
      }
      setLocksSamples(samples);
      await startLocks();
      const s = useLocksSession.getState();
      if (s.error || s.cancelled || !s.results[0]) {
        throw new Error(s.error ?? "locks run did not finish");
      }
      const run = s.results[0];
      // A reference capture measures every build. A missing one is almost
      // always a setup fault (no cross-origin isolation, an old browser).
      const missing = lockVariants.filter((v) => !run.variants.includes(v));
      if (missing.length) {
        throw new Error(`locks did not measure ${missing.map((v) => `${v} (${run.skipped[v] ?? "no reason given"})`).join(", ")}`);
      }
      return {
        input: null,
        corpus: [],
        method: rotateMethod(samples, true),
        params: { iterations: LOCKS_ITERATIONS, wasmOpt: "none", builds: lockVariants, measured: run.variants, skipped: run.skipped, flags: run.flags, workloads: lockWorkloads, calls: run.calls },
        raw: run,
      };
    }
  }
}

/** The wasm modules a benchmark loads, by path under src/wasm. */
const artifactsFor = (bench: BenchId) =>
  build.artifacts.filter(({ name }) => {
    switch (bench) {
      case "compression":
        return !name.startsWith("alloc") && !name.startsWith("memory64") && !name.startsWith("locks_") && !name.startsWith("variants/");
      case "allocation":
        return name.startsWith("alloc");
      case "memory64":
        return name.startsWith("memory64");
      case "build":
        return name.startsWith("variants/") || name === "zstd_write_bg.wasm" || name === "corpus_bg.wasm";
      case "locks":
        return name.startsWith("locks_");
    }
  });

async function capture(bench: BenchId, input: CorpusId | null, samples: number, only: readonly SubjectKey[] | null): Promise<Edition> {
  const [facts, timer] = await Promise.all([browserFacts(), measureWorkerTimer()]);
  const started = new Date();
  const result = await runBench(bench, input, samples, only);
  const ended = new Date();
  const id = facts.name.toLowerCase();
  return {
    schema: EDITION_SCHEMA,
    id: started.toISOString().slice(0, 10),
    bench,
    input: result.input,
    repeat: { index: 1, of: 1 },
    capturedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    machine: {
      id: "unknown",
      cpuModel: "unknown",
      cpuFlags: [],
      arch: facts.arch ?? "unknown",
      cores: navigator.hardwareConcurrency ?? null,
      os: facts.platform ?? "unknown",
      power: { source: "unknown", lowPowerMode: null },
    },
    browser: {
      id: (["chrome", "firefox", "safari"] as BrowserId[]).find((b) => b === id) ?? "other",
      name: facts.name,
      version: facts.version,
      userAgent: facts.userAgent,
      headless: /Headless/.test(facts.userAgent) || navigator.webdriver === true,
      crossOriginIsolated: globalThis.crossOriginIsolated === true && timer.crossOriginIsolated,
      timerResolutionMs: timer.medianStepMs,
      timerMinStepMs: timer.minStepMs,
    },
    toolchain: {
      rustc: build.rustc,
      rustcNightly: build.rustcNightly,
      wasiSdk: build.toolchain.wasiSdk,
      binaryen: build.toolchain.binaryen,
      wasmBindgen: build.wasmBindgen,
      profile: { optLevel: build.optLevel, lto: build.lto, codegenUnits: build.codegenUnits, targetFeatures: build.targetFeatures, wasmOpt: build.wasmOpt },
      crates: build.libraries,
    },
    commit: build.commit,
    artifacts: artifactsFor(bench),
    corpus: build.corpus.filter((c) => (result.corpus as string[]).includes(c.id)),
    method: result.method,
    params: result.params,
    raw: result.raw,
  };
}

/**
 * The one capture this page load runs. Module state, not component state:
 * React StrictMode (dev) mounts effects twice, and a second run would find
 * the benchmark busy and report it unfinished.
 */
type Run = { state: CaptureState; listeners: Set<() => void> };
let current: Run | undefined;
const IDLE: CaptureState = { status: "idle" };

function startOnce(): Run | undefined {
  if (current) {
    return current;
  }
  const q = new URLSearchParams(window.location.search);
  const bench = q.get("bench") as BenchId | null;
  if (!bench || !benchIds.includes(bench)) {
    return undefined;
  }
  const inputParam = q.get("input");
  const input = corpora.some((c) => c.id === inputParam) ? (inputParam as CorpusId) : null;
  const samples = Number(q.get("samples") ?? DEFAULT_SAMPLES[bench]);
  // Build only: a subset of subjects, for scripts/capture.mjs --subjects.
  const subjectsParam = q.get("subjects");
  const only = bench === "build" && subjectsParam ? subjectsParam.split(",").filter((k): k is SubjectKey => (subjectKeys as readonly string[]).includes(k)) : null;
  if (only && only.length !== subjectsParam!.split(",").length) {
    window.benchCapture = { status: "error", error: `unknown subject in ${subjectsParam}; known: ${subjectKeys.join(", ")}` };
    return undefined;
  }
  const run: Run = { state: { status: "running", detail: `${bench}${input ? ` on ${input}` : ""}, ${samples} samples` }, listeners: new Set() };
  current = run;
  const update = (s: CaptureState) => {
    run.state = s;
    window.benchCapture = s;
    run.listeners.forEach((l) => l());
  };
  update(run.state);
  capture(bench, input, samples, only).then(
    (edition) => update({ status: "done", edition }),
    (e: unknown) => update({ status: "error", error: e instanceof Error ? e.message : String(e) }),
  );
  return run;
}

const subscribe = (listener: () => void) => {
  const run = startOnce();
  run?.listeners.add(listener);
  return () => {
    run?.listeners.delete(listener);
  };
};

function Capture() {
  const state = useSyncExternalStore(
    subscribe,
    () => current?.state ?? IDLE,
    () => IDLE,
  );

  return (
    <main style={{ padding: 16, fontFamily: "monospace", fontSize: 12 }}>
      <p data-testid="status">
        {state.status}
        {state.status === "running" && state.detail ? `: ${state.detail}` : ""}
        {state.status === "error" ? `: ${state.error}` : ""}
      </p>
      {state.status === "idle" && <p>Usage: /capture?bench=compression|allocation|memory64|build|locks[&amp;input=dickens][&amp;samples=N][&amp;subjects=a,b]</p>}
    </main>
  );
}
