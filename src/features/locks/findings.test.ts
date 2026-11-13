import { describe, expect, it } from "vitest";
import { ask, askReproduced, type MachineRef } from "@/lib/findings";
import { validateEdition } from "@/lib/edition";
import { comparisonEffect, ratioWords, runClaim } from "./claims";
import { editionFindings, figureTitle, lockCost, type LocksCell, unwindCost } from "./findings";
import type { ResultRow } from "./harness";
import { lockComparisons, type Variant, variants, type WorkloadId, workloadIds } from "./workloads";

const m4: MachineRef = { id: "m4pro-arm64", cpuModel: "Apple M4 Pro", arch: "arm64" };

/** Every cell at 1 ns, with `scale` multiplying the named cells; a little noise per round. */
const row = (scale: Partial<Record<`${Variant} ${WorkloadId}`, number>> = {}, n = 20, measured: readonly Variant[] = variants): ResultRow => ({
  id: 1,
  iterations: 4096,
  variants: [...measured],
  skipped: {},
  flags: {},
  calls: Object.fromEntries(workloadIds.map((w) => [w, 100])) as Record<WorkloadId, number>,
  samples: Object.fromEntries(
    measured.map((v) => [v, Object.fromEntries(workloadIds.map((w) => [w, Array.from({ length: n }, (_, i) => (1 + (i % 3) * 0.005) * (scale[`${v} ${w}`] ?? 1))]))]),
  ),
  checksumsMatch: true,
  startedAt: 0,
  endedAt: 0,
});
const cell = (engine: string, r: ResultRow): LocksCell => ({ engine, machine: m4, input: null, row: r });

describe("locks claims", () => {
  it("words a time ratio by its size", () => {
    expect(ratioWords(3.1)).toBe("3.1× as long as");
    expect(ratioWords(1.25)).toBe("25% longer than");
    expect(ratioWords(0.8)).toBe("20% less time than");
  });
  it("pairs a comparison round by round, and skips a build that was not measured", () => {
    const r = row({ "abort op/mutex": 3 });
    expect(comparisonEffect(r, lockComparisons("abort")[0])?.median).toBeCloseTo(3, 6);
    expect(comparisonEffect(row({}, 20, ["abort"]), lockComparisons("unwind")[0])).toBeUndefined();
    expect(runClaim(r)).toBe("In the default build, a Mutex lock took 3× as long as a RefCell borrow.");
  });
});

describe("locks findings", () => {
  it("claims Mutex against RefCell with its scope", () => {
    const f = ask(lockCost, [cell("Chrome", row({ "abort op/mutex": 3 })), cell("Firefox", row({ "abort op/mutex": 3 }))]);
    expect(f.claim?.text).toBe("In the default build, a Mutex lock took 3× as long as a RefCell borrow in Chrome and Firefox (Figure 2).");
    expect(f.claim?.key).toBe("locks.mutex-refcell-op:abort:slower");
  });
  it("names the browsers where a claim holds", () => {
    const f = ask(lockCost, [cell("Chrome", row({ "abort op/mutex": 3 })), cell("Firefox", row())]);
    expect(f.title).toBe("In the default build, a Mutex lock took 3× as long as a RefCell borrow in Chrome");
  });
  it("gives the other direction its own clause where browsers disagree", () => {
    const f = ask(unwindCost, [cell("Chrome", row({ "unwind op/mutex": 1.4 })), cell("Firefox", row({ "unwind op/mutex": 0.8 }))]);
    expect(f.title).toBe("With panic=unwind, a Mutex lock took 40% longer than with panic=abort in Chrome, but 20% less time in Firefox");
    expect(f.claim?.text).toBe("With panic=unwind, a Mutex lock took 40% longer than with panic=abort in Chrome, but 20% less time in Firefox (Figure 3).");
    expect(f.claim?.key).toBe("locks.build-op/mutex:unwind:slower");
  });
  it("makes no claim within the threshold", () => {
    const f = ask(unwindCost, [cell("Chrome", row({ "unwind op/mutex": 1.02 }))]);
    expect(f.claim).toBeUndefined();
    expect(figureTitle([f], 3)).toBe("Each build ÷ the default build, same workload");
  });
  it("keeps a claim only when a second capture reproduces it", () => {
    const slow = cell("Chrome", row({ "unwind op/mutex": 1.4 }));
    expect(askReproduced(unwindCost, [slow], []).claim).toBeUndefined();
    expect(askReproduced(unwindCost, [slow], [[cell("Chrome", row())]]).claim).toBeUndefined();
    expect(askReproduced(unwindCost, [slow], [[cell("Chrome", row({ "unwind op/mutex": 1.35 }))]]).claim?.text).toBe(
      "With panic=unwind, a Mutex lock took 40% longer than with panic=abort in Chrome (Figure 3).",
    );
  });
  it("reports claims that wait on a second capture, or that it did not reproduce", () => {
    const r = row({ "abort op/mutex": 3, "unwind op/mutex": 3, "atomics op/mutex": 3 });
    expect(editionFindings([{ engine: "Chrome", machine: m4, run: r, replicates: [] }]).pending.map((c) => c.key)).toEqual(["locks.mutex-refcell-op:abort:slower"]);
    const { findings, pending } = editionFindings([{ engine: "Chrome", machine: m4, run: r, replicates: [row()] }]);
    expect(findings[0].claim).toBeUndefined();
    expect(pending.map((c) => c.key)).toEqual(["locks.mutex-refcell-op:abort:slower"]);
  });
  it("gates every setting of an edition", () => {
    const r = row({ "abort op/mutex": 3, "unwind op/mutex": 3, "atomics op/mutex": 6 });
    const [lock, unwind, atomics] = editionFindings([{ engine: "Chrome", machine: m4, run: r, replicates: [r] }]).findings;
    expect(lock.claim).toBeDefined();
    expect(unwind.claim).toBeUndefined();
    expect(atomics.claim?.text).toBe("With +atomics, a Mutex lock took 2× as long as without it in Chrome (Figure 3).");
  });
});

describe("locks capture validation", () => {
  const edition = (raw: unknown) => ({
    schema: 1,
    id: "2026-11-11",
    bench: "locks",
    input: null,
    repeat: { index: 1, of: 2 },
    capturedAt: "2026-11-11T10:00:00.000Z",
    endedAt: "2026-11-11T10:02:00.000Z",
    machine: { id: "m4pro-arm64", cpuModel: "Apple M4 Pro", arch: "arm64", cores: 14, os: "macOS 26.1", cpuFlags: [], power: { source: "AC", lowPowerMode: false } },
    browser: { id: "chrome", name: "Chrome", version: "156.0", userAgent: "x", headless: true, crossOriginIsolated: true, timerResolutionMs: 0.005, timerMinStepMs: 0.005 },
    toolchain: { rustc: "rustc 1.99.1", rustcNightly: "nightly-2026-11-01", wasiSdk: "wasi-sdk-29", binaryen: "133", wasmBindgen: "0.2.130", profile: {}, crates: {} },
    commit: { sha: "a".repeat(40), dirty: false },
    artifacts: [{ name: "locks_abort_bg.wasm", sha256: "b".repeat(64), bytes: 1 }],
    corpus: [],
    method: { samples: 20, batchTargetMs: 50, warmup: {}, order: "rotate", paired: true },
    params: {},
    raw,
  });
  it("accepts a full run and rejects short series or differing digests", () => {
    expect(validateEdition(edition(row()))).toEqual([]);
    expect(validateEdition(edition(row({}, 19)))).toContain("raw.samples[abort][op/plain]: expected 20 positive samples");
    expect(validateEdition(edition({ ...row(), checksumsMatch: false as never }))).toEqual(["raw checksums differ between builds"]);
    expect(validateEdition(edition({ ...row(), variants: ["unwind"] }))).toEqual(["raw must be a locks run that measured the abort build"]);
    expect(validateEdition(edition({ ...row(), variants: ["abort", "atomic"] }))).toContain("raw.variants must be among abort, unwind, atomics");
    expect(validateEdition(edition({ ...row(), skipped: undefined }))).toEqual(["raw must record skipped, flags, calls and iterations"]);
    const short = row();
    const { "op/plain": _dropped, ...rest } = short.samples.unwind!;
    short.samples.unwind = rest as typeof short.samples.abort;
    expect(validateEdition(edition(short))).toEqual(["raw.samples[unwind] has other workloads than raw.samples[abort]"]);
  });
});
