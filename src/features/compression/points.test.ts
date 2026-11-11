import { describe, expect, it } from "vitest";
import { facets } from "@/data/editions";
import { type MachineRef, POINT_WORDS, wordCount } from "@/lib/findings";
import { configId, type Family } from "./codecs";
import type { CompressionCell } from "./findings";
import { browserPoint, countScope, decoderPoint, type EditionCell, editionPoints, type EngineGroup, engineRatios, nearEverywhere, ratioRange, whereText } from "./points";
import { allCaptures, editionCells, editionSummary, engineGroups, FIGURES, reference, REFERENCE_MACHINE, referenceFindings } from "./release";
import { resultRows } from "./results";
import type { CompressionRun } from "./types";

const m4: MachineRef = { id: "m4pro-arm64", cpuModel: "Apple M4 Pro", arch: "arm64" };
const BYTES = 10_000_000;
/** A config: decode and encode MB/s. */
type Spec = [Family, number | null, number, number];

function cell(input: string, engine: string, specs: Spec[]): CompressionCell {
  const ms = (mbps: number) => Array.from({ length: 10 }, (_, i) => (BYTES / (mbps * 1e6)) * 1000 * (1 + (i % 3) * 0.002));
  const run: CompressionRun = {
    id: 1,
    filename: input,
    synthetic: true,
    bytes: BYTES,
    samples: 10,
    startedAt: 0,
    status: "done",
    configs: specs.map(([family, level, dec, enc]) => ({
      spec: { id: configId(family, level), family, level },
      size: Math.round(BYTES / 3),
      roundTrip: true,
      encodeMs: ms(enc),
      decodeMs: ms(dec),
    })),
  };
  return { engine, machine: m4, input, rows: resultRows(run) };
}

/** libdeflate and zlib-rs clearly ahead; with `close`, miniz_oxide sits near them and no tier stands clear. */
const decoders = (close = false): Spec[] => [
  ["libdeflate", 6, 1000, 100],
  ["zlibrs", 6, 950, 120],
  ["miniz", 6, close ? 680 : 400, 90],
  ["pako", 6, 300, 40],
];

const settled = (c: CompressionCell): EditionCell => ({ cell: c, replicates: [c] });

describe("edition main points: scope where cells disagree", () => {
  it("counts the cells where a group of decoders was clearly fastest, and names only decoders in every one", () => {
    const cells = [
      settled(cell("dickens", "Chrome", decoders())),
      settled(cell("dickens", "Firefox", decoders())),
      settled(cell("xml", "Chrome", decoders())),
      settled(cell("xml", "Firefox", decoders(true))),
    ];
    expect(decoderPoint(cells, "deflate", 3)?.text).toBe(
      "libdeflate and zlib-rs were among the fastest Deflate decoders wherever a group led clearly: 3 of 4 input–browser pairs (Figure 3, per input and browser).",
    );
  });

  it("leaves out a cell whose replicate doesn't reproduce its tier", () => {
    const cells = [settled(cell("dickens", "Chrome", decoders())), { cell: cell("xml", "Chrome", decoders()), replicates: [cell("xml", "Chrome", decoders(true))] }];
    expect(decoderPoint(cells, "deflate", 3)?.text).toMatch(/wherever a group led clearly: 1 of 2 (input–browser )?pairs \(Figure 3, per input and browser\)\.$/);
  });

  it("says all when every cell holds", () => {
    const cells = ["dickens", "xml"].flatMap((i) => ["Chrome", "Safari"].map((e) => settled(cell(i, e, decoders()))));
    expect(decoderPoint(cells, "deflate", 3)?.text).toBe("libdeflate and zlib-rs were among the fastest Deflate decoders in every input and browser (Figure 3, per input and browser).");
  });

  it("calls a lone common member the fastest only where it led alone in every cell", () => {
    const alone: Spec[] = [
      ["libdeflate", 6, 1000, 100],
      ["zlibrs", 6, 600, 120],
      ["miniz", 6, 400, 90],
      ["pako", 6, 300, 40],
    ];
    // Firefox: zlib-rs is faster than libdeflate, both in the clear group.
    const shared: Spec[] = alone.map(([f, l, d, e]) => [f, l, f === "zlibrs" ? 1100 : d, e]);
    const chrome = settled(cell("dickens", "Chrome", alone));
    expect(decoderPoint([chrome, settled(cell("dickens", "Firefox", shared))], "deflate", 3)?.text).toBe(
      "libdeflate was among the fastest Deflate decoders in every input and browser (Figure 3, per input and browser).",
    );
    expect(decoderPoint([chrome, settled(cell("dickens", "Firefox", alone))], "deflate", 3)?.text).toBe(
      "libdeflate was the fastest Deflate decoder in every input and browser (Figure 3, per input and browser).",
    );
  });

  it("words scope as a grid where it is one, else as a count", () => {
    const all = ["a", "b", "c", "d"].flatMap((i) => ["Chrome", "Firefox", "Safari"].map((engine) => ({ engine, machine: m4, input: i })));
    expect(whereText(all.filter((c) => c.input !== "d"), all)).toBe("on 3 of 4 inputs, in all 3 browsers");
    expect(whereText(all.filter((c) => !(c.input === "d" && c.engine === "Chrome")), all)).toBe("in 11 of 12 input–browser pairs");
    expect(countScope(all, all)).toBe("in all 12 input–browser pairs");
  });
});

/** Base engine and another, one input, two captures: every Deflate implementation scaled by its factor in the other. */
function group(input: string, other: string, factors: Partial<Record<Family, number>>): EngineGroup {
  const specs: Spec[] = [
    ["native", null, 500, 100],
    ["libdeflate", 6, 1000, 100],
    ["zlibrs", 6, 950, 120],
    ["pako", 6, 300, 40],
    ["fflate", 6, 400, 50],
  ];
  const scaled = specs.map(([f, l, d, e]): Spec => [f, l, d * (factors[f] ?? 1), e * (factors[f] ?? 1)]);
  return {
    input,
    machine: m4.id,
    base: { engine: "Chrome", captures: [cell(input, "Chrome", specs), cell(input, "Chrome", specs)] },
    others: [{ engine: other, captures: [cell(input, other, scaled), cell(input, other, scaled)] }],
  };
}

describe("edition main points: browser dependence", () => {
  const groups = ["dickens", "xml"].map((i) => group(i, "Firefox", { native: 0.5, libdeflate: 0.9, zlibrs: 0.95, pako: 0.6, fflate: 1.4 }));

  it("states the wasm codecs' range against the base browser, both ways, and the range of what strayed beyond it", () => {
    // wasm 0.9 and 0.95; native 0.5, pako 0.6, fflate 1.4.
    expect(browserPoint(groups, ["deflate"], 4)?.text).toBe(
      "In Firefox, the wasm Deflate codecs ran at 0.90–0.95× Chrome's speed; built-in gzip and the JavaScript libraries at 0.50–1.40× (Figure 4).",
    );
  });

  it("claims nothing for a runtime that stayed within the wasm bound on some input", () => {
    const mixed = [group("dickens", "Firefox", { native: 0.5, libdeflate: 0.8, pako: 0.6 }), group("xml", "Firefox", { native: 0.5, libdeflate: 0.8, pako: 0.9, fflate: 0.9 })];
    expect(browserPoint(mixed, ["deflate"], 4)?.text).toMatch(/; built-in gzip at 0\.50× \(Figure 4\)\.$/);
  });

  it("widens a range outward to two decimals, so it covers every value", () => {
    expect(ratioRange([0.738, 1.224])).toBe("0.73–1.23×");
    expect(ratioRange([0.5, 0.5])).toBe("0.50×");
  });

  it("gives every ratio with its engine, input and metric, for the figure", () => {
    const rs = engineRatios(groups, ["deflate"]);
    // 2 inputs × 2 captures × 5 implementations × 2 metrics.
    expect(rs).toHaveLength(40);
    expect(rs.filter((x) => x.family === "native").every((x) => Math.abs(x.ratio - 0.5) < 1e-9 && x.engine === "Firefox")).toBe(true);
  });
});

describe("edition main points: the reference edition", () => {
  const f = facets(allCaptures);
  const { points } = editionSummary();

  it("are at most four, each within the word limit and citing one figure", () => {
    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThanOrEqual(4);
    for (const p of points) {
      expect(wordCount(p.text)).toBeLessThanOrEqual(POINT_WORDS);
      // One citation each; a figure in the details section says it is per input and browser.
      expect(p.text.match(/\(Figure \d+(, per input and browser)?\)/g)).toHaveLength(1);
    }
  });

  it("read every input and browser, so every switch state shows the same points, and no figure title repeats one", () => {
    // The points come from all cells at once, whatever the page selects.
    expect(editionPoints(editionCells(), engineGroups(), FIGURES)).toEqual(points);
    for (const input of f.inputs) {
      for (const browser of f.browsers) {
        expect(editionSummary().points).toEqual(points);
        const titles = referenceFindings(reference(input, browser, REFERENCE_MACHINE)).map((x) => x.title);
        for (const p of points) {
          expect(titles).not.toContain(p.text);
          expect(titles.map((t) => `${t} (Figure`)).not.toContain(p.text.replace(/ \(Figure \d+\)\.$/, " (Figure"));
        }
      }
    }
  });

  it("states where cells disagree instead of claiming every input and browser", () => {
    const cells = editionCells();
    expect(cells).toHaveLength(f.inputs.length * f.browsers.length);
    for (const p of points) {
      // A point either holds everywhere, or says where.
      expect(p.text).toMatch(/everywhere|every input and browser|except for|all \d+|\d+ of \d+|In (Firefox|Safari|Chrome)/);
    }
  });

  it("names the download that was fastest or within a whole percent of it at every bandwidth, input, browser and capture", () => {
    const near = nearEverywhere(editionCells(), "download")!;
    expect(near.name).toBe("zstd 15");
    expect(near.pct).toBe(1);
    const download = points.find((p) => p.figure === FIGURES.downloadMap)!;
    expect(download.text).toMatch(/^Of the levels tested, zstd 15 downloaded fastest or within 1%(?: of the fastest)? everywhere; clearly fastest from ≈\d+ to \d+ Mbps except on x-ray \(Figure 1\)\.$/);
  });

  it("cites the across-inputs figures, then the decoders in the details", () => {
    expect(points.map((p) => p.figure)).toEqual([FIGURES.downloadMap, FIGURES.uploadMap, FIGURES.browsers, FIGURES.impl[0].decode]);
  });
});
