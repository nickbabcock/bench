import { describe, expect, it } from "vitest";
import { ask, type MachineRef, POINT_WORDS, wordCount } from "@/lib/findings";
import type { ResultRow } from "./harness";
import { aaPooled, aaSummary, aaTitle, buildCells, informativeRows, o3Sentence, simdInteraction, simdSizeSentence, simdSpeed, skipWasmOptSpeed, type SizeData, unreproduced, wasmOptSize } from "./findings";
import { contrast, contrastById } from "./results";
import { type SubjectKey, type VariantId, variantIds } from "./subjects";

const m4: MachineRef = { id: "m4pro-arm64", cpuModel: "Apple M4 Pro", arch: "arm64" };
const N = 15;
/** Deterministic ±1% jitter so CIs have width. */
const jitter = (i: number) => 1 + 0.01 * (((i * 7) % 5) - 2) / 2;

function row(subject: SubjectKey, input: string, factors: Partial<Record<VariantId, number>> = {}): ResultRow {
  const samples = Object.fromEntries(
    variantIds.map((v) => [v, Array.from({ length: N }, (_, i) => 10 * (factors[v] ?? 1) * jitter(i + v.length))]),
  ) as ResultRow["samples"];
  return { id: 1, subject, input: { name: input, bytes: 1 }, payloadBytes: 1, repetitions: 1, samples, checksumsMatch: true, startedAt: 0, endedAt: 0 };
}

const capture = (simdInflate: number, aaBias = 1) => [
  row("zlib-rs-inflate", "dickens", { "on-Os": simdInflate }),
  row("zlib-rs-inflate", "x-ray", { "on-Os": simdInflate }),
  row("lz4-decode", "dickens", { "on-Os": 1.01 }),
  row("lz4-decode", "x-ray", { "on-Os": 0.8, "off-Os-aa": aaBias }),
];

describe("build contrasts", () => {
  it("pairs each factor against its fixed partner", () => {
    const r = row("zstd-decode", "dickens", { "on-Os": 0.9, "off-none": 1.1 });
    const claim = (id: string) => contrast(r, contrastById(id)!).effect.claim;
    expect(claim("simd@Os")).toBe("faster");
    expect(claim("skip-wasm-opt@off")).toBe("slower");
    expect(claim("simd@O3")).toBe("same");
    expect(claim("aa")).toBe("same");
  });
});

describe("build findings", () => {
  const cells = [...buildCells(capture(0.88), "Chrome", m4), ...buildCells(capture(0.95), "Firefox", m4)];

  it("states the broadest SIMD effect with its scope, as a range over the cells", () => {
    const f = ask(simdSpeed, cells);
    expect(f.claim?.key).toBe("build.simd@Os:zlib-rs-inflate:faster");
    // Chrome 0.88 and Firefox 0.95: a range, never one pooled value.
    expect(f.title).toMatch(/^simd128 cut zlib-rs inflate's time by [\d.]+%–[\d.]+% on both inputs, in Chrome and Firefox$/);
    // Read first, so it stands alone: the effect at its largest; the title has the range and scope.
    expect(f.claim?.text).toMatch(/^On arm64, simd128 cut zlib-rs inflate's time by up to [\d.]+% \(Figure 1\)\.$/);
    expect(f.claim?.cells).toHaveLength(4);
    expect(f.tableOnly.map((c) => c.key)).toContain("build.simd@Os:lz4-decode:faster");
  });

  it("excludes rows whose A/A control fails", () => {
    const biased = buildCells(capture(1, 1.2), "Chrome", m4);
    // lz4 on x-ray would claim "faster", but its A/A is biased.
    expect(ask(simdSpeed, biased).claim).toBeUndefined();
    expect(aaSummary(biased).failures).toMatchObject([{ subject: "lz4-decode", inputs: ["x-ray"], of: 2 }]);
  });

  it("is neutral when nothing clears the threshold", () => {
    expect(ask(skipWasmOptSpeed, cells).title).toBe("Speed without wasm-opt against wasm-opt -Os");
  });

  it("scopes a reference claim to the cells every capture reproduces", () => {
    // zlib-rs inflate is faster on both inputs in capture 1, but only on dickens in capture 2.
    const first = capture(0.88).slice(0, 2);
    const second = [row("zlib-rs-inflate", "dickens", { "on-Os": 0.88 }), row("zlib-rs-inflate", "x-ray", { "on-Os": 1 })];
    const f = ask(simdSpeed, buildCells(first, "Chrome", m4, [second]));
    expect(f.title).toMatch(/^simd128 cut zlib-rs inflate's time by [\d.]+% on dickens, in Chrome$/);
    expect(f.claim?.text).toMatch(/^On arm64, simd128 cut zlib-rs inflate's time by [\d.]+% \(Figure 1\)\.$/);
    expect(unreproduced(buildCells(first, "Chrome", m4, [second]), "simd@Os").map((c) => c.input)).toEqual(["x-ray"]);
  });

  it("names every workload that moved the other way, each with its own size and scope, and never says slightly", () => {
    const chrome = [
      row("zlib-rs-inflate", "dickens", { "on-Os": 0.8 }),
      row("zlib-rs-inflate", "x-ray", { "on-Os": 0.8 }),
      row("zstd-decode", "dickens", { "on-Os": 1.045 }),
      row("zstd-decode", "x-ray", { "on-Os": 1 }),
      row("lz4-decode", "dickens", { "on-Os": 1 }),
      row("lz4-decode", "x-ray", { "on-Os": 1 }),
    ];
    const firefox = [
      row("zlib-rs-inflate", "dickens", { "on-Os": 0.8 }),
      row("zlib-rs-inflate", "x-ray", { "on-Os": 0.8 }),
      row("zstd-decode", "dickens", { "on-Os": 1 }),
      row("zstd-decode", "x-ray", { "on-Os": 1.045 }),
      row("lz4-decode", "dickens", { "on-Os": 1.1 }),
      row("lz4-decode", "x-ray", { "on-Os": 1 }),
    ];
    const f = ask(simdSpeed, [...buildCells(chrome, "Chrome", m4), ...buildCells(firefox, "Firefox", m4)]);
    // Both slowdowns, the largest first; zstd's ragged scope per browser (not "in Chrome and Firefox").
    expect(f.claim?.text).toMatch(/^On arm64, simd128 cut zlib-rs inflate's time by [\d.]+%, but slowed 2 workloads, lz4_flex decode most, by [\d.]+% (on dickens )?in Firefox \(Figure 1\)\.$/);
    expect(wordCount(f.claim!.text)).toBeLessThanOrEqual(POINT_WORDS);
    expect(f.claim?.text).not.toMatch(/slightly/);
    const small = ask(simdSpeed, buildCells([row("zstd-decode", "dickens", { "on-Os": 0.96 })], "Firefox", m4));
    expect(small.title).toMatch(/^simd128 cut zstd decode's time slightly, by [\d.]+%/);
  });

  it("names the other way's largest workload with its size", () => {
    const chrome = [row("zlib-rs-inflate", "dickens", { "on-Os": 0.8 }), row("zstd-decode", "dickens", { "on-Os": 1.08 })];
    const one = ask(simdSpeed, buildCells(chrome, "Chrome", m4));
    expect(one.claim?.text).toMatch(/^On arm64, simd128 cut zlib-rs inflate's time by [\d.]+%, but slowed zstd decode by [\d.]+% \(Figure 1\)\.$/);
    const two = ask(simdSpeed, buildCells([...chrome, row("lz4-decode", "dickens", { "on-Os": 1.1 })], "Chrome", m4));
    expect(two.claim?.text).toMatch(/^On arm64, simd128 cut zlib-rs inflate's time by [\d.]+%, but slowed 2 workloads, lz4_flex decode most, by [\d.]+% \(Figure 1\)\.$/);
  });

  it("repeats the lead's browsers only when some browsers didn't hold it", () => {
    const flat = [row("zlib-rs-inflate", "dickens"), row("zlib-rs-inflate", "x-ray")];
    const mixed = [...buildCells(capture(0.88).slice(0, 2), "Chrome", m4), ...buildCells(flat, "Firefox", m4)];
    expect(ask(simdSpeed, mixed).title).toMatch(/^simd128 cut zlib-rs inflate's time by [\d.]+% on both inputs, in Chrome$/);
  });

  it("shows only rows with a claim or a difference between engines", () => {
    const c = [...buildCells(capture(0.88), "Chrome", m4), ...buildCells(capture(0.88), "Firefox", m4)];
    // lz4 on dickens (1.01) claims nothing in either engine and they agree.
    expect([...informativeRows(c, "simd@Os")].sort()).toEqual(["lz4-decode:x-ray", "zlib-rs-inflate:dickens", "zlib-rs-inflate:x-ray"]);
  });

  it("titles the A/A control: its spread where it passed, the module where it failed", () => {
    const first = [row("zstd-decode", "dickens", { "off-Os-aa": 1.35 }), row("zstd-decode", "x-ray", { "off-Os-aa": 1.3 })];
    const mixed = [...buildCells(capture(1), "Chrome", m4, [capture(1)]), ...buildCells(first, "Safari", m4, [first])];
    expect(aaTitle(mixed)).toMatch(/^A\/A control: within ±[\d.]+% in Chrome; failed for the zstd decoder in Safari$/);
  });

  it("keeps machines apart when pooling the A/A control", () => {
    const x86: MachineRef = { id: "x86", cpuModel: "Intel", arch: "x86_64" };
    const ok = [row("zstd-decode", "dickens")];
    const bad = [row("zstd-decode", "dickens", { "off-Os-aa": 1.2 })];
    const pooled = aaPooled([...buildCells(ok, "Chrome", m4, [ok]), ...buildCells(bad, "Chrome", x86, [bad])]);
    expect(pooled.map((p) => [p.machine.id, p.rejected])).toEqual([
      ["m4pro-arm64", false],
      ["x86", true],
    ]);
  });

  it("words the SIMD size change with its sign", () => {
    const m = (brotli: number) => ({ bytes: { raw: brotli, gzip: brotli, brotli } }) as never;
    expect(simdSizeSentence({ zlib_rs: { "off-Os": m(1000), "on-Os": m(995) }, lz4: { "off-Os": m(1000), "on-Os": m(1029) } })).toBe(
      "simd128 changed each module's brotli bytes at wasm-opt -Os from 0.5% smaller to 2.9% larger.",
    );
    expect(simdSizeSentence({ zlib_rs: { "off-Os": m(1000), "on-Os": m(980) }, lz4: { "off-Os": m(1000), "on-Os": m(990) } })).toBe(
      "simd128 made every module 1%–2% smaller at wasm-opt -Os (brotli bytes).",
    );
  });

  it("keeps the neutral wording when no cell remains", () => {
    expect(o3Sentence([])).toBe("wasm-opt -O3 instead of -Os changed the speed of no workload beyond the ±3% threshold (Table 1).");
    expect(aaTitle([])).toBe("A/A control");
  });

  it("puts -O3 in one sentence citing the table", () => {
    expect(o3Sentence(buildCells(capture(0.88), "Chrome", m4))).toMatch(/^wasm-opt -O3 instead of -Os changed the speed of no workload/);
  });

  it("claims nothing for a reference cell with no repeat capture", () => {
    expect(ask(simdSpeed, buildCells(capture(0.88), "Chrome", m4, [])).claim).toBeUndefined();
  });

  it("finds the SIMD × wasm-opt interaction", () => {
    const r = row("lz4-decode", "dickens", { "on-none": 0.9, "on-Os": 0.92, "on-O3": 1.01, "off-O3": 1 });
    const x = simdInteraction(buildCells([r], "Firefox", m4));
    expect(x?.levels.map((l) => l.claim)).toEqual(["faster", "faster", "same"]);
  });

  it("names the crate wasm-opt grew", () => {
    const m = (raw: number, brotli: number) => ({ bytes: { raw, gzip: brotli, brotli } }) as never;
    const sizes: SizeData = {
      zstd_read: { "off-none": m(100, 100), "off-Os": m(80, 80), "on-Os": m(82, 82) },
      zlib_rs: { "off-none": m(100, 100), "off-Os": m(90, 90), "on-Os": m(91, 91) },
      br_write: { "off-none": m(400, 378_944), "off-Os": m(390, 395_037), "on-Os": m(390, 395_100) },
    };
    const f = ask(wasmOptSize, sizes);
    expect(f.title).toBe("wasm-opt -Os shrank 2 of 3 modules and grew the brotli encoder; simd128 grew all 3");
    expect(f.claim?.text).toBe("wasm-opt -Os shrank most modules by up to 20 B after compression, but grew the brotli encoder by 16.1 kB (Figure 3).");
  });
});

describe("build main points over the edition", () => {
  it("read every engine at once, so the order the facets are shown in doesn't change them", () => {
    const chrome = buildCells(capture(0.88), "Chrome", m4);
    const firefox = buildCells(capture(0.95), "Firefox", m4);
    const points = (cells: typeof chrome) => [simdSpeed, skipWasmOptSpeed].map((q) => ask(q, cells).claim?.text);
    expect(points([...firefox, ...chrome])).toEqual(points([...chrome, ...firefox]));
    for (const t of points([...chrome, ...firefox])) {
      expect(t === undefined || wordCount(t) <= POINT_WORDS).toBe(true);
    }
  });
});
