import { describe, expect, it } from "vitest";
import { ask, type MachineRef, POINT_WORDS, wordCount } from "@/lib/findings";
import { configId, type Family } from "./codecs";
import {
  askJoint,
  cellBands,
  codeSize,
  type CompressionCell,
  decodeImplementations,
  decoderTiers,
  rangeText,
  STREAM_ALLOWANCE,
  topTier,
  transferQuestion,
} from "./findings";
import { resultRows } from "./results";
import type { CompressionRun } from "./types";

const m4: MachineRef = { id: "m4pro-arm64", cpuModel: "Apple M4 Pro", arch: "arm64" };
const BYTES = 10_000_000;

/** A config: ratio, decode and encode MB/s, gzipped decoder bytes. */
type Spec = [Family, number | null, number, number, number, number];

function run(specs: Spec[]): CompressionRun {
  const ms = (mbps: number) => Array.from({ length: 10 }, (_, i) => (BYTES / (mbps * 1e6)) * 1000 * (1 + (i % 3) * 0.002));
  return {
    id: 1,
    filename: "x",
    synthetic: true,
    bytes: BYTES,
    samples: 10,
    startedAt: 0,
    status: "done",
    configs: specs.map(([family, level, ratio, dec, enc, code]) => ({
      spec: { id: configId(family, level), family, level },
      size: Math.round(BYTES / ratio),
      roundTrip: true,
      code: { decode: code, encode: code, shared: true, source: "measured" as const },
      encodeMs: ms(enc),
      decodeMs: ms(dec),
    })),
  };
}

// lz4 is fastest with the lowest ratio; zstd dominates the middle and top;
// zlib-rs is dominated everywhere.
const specs: Spec[] = [
  ["lz4", null, 2.0, 4000, 600, 9_000],
  ["zstd", 1, 2.8, 1500, 400, 120_000],
  ["zstd", 9, 3.4, 1400, 40, 120_000],
  ["zlibrs", 6, 2.7, 400, 30, 40_000],
];
const cell = (input: string, engine = "Chrome", s = specs): CompressionCell => ({ engine, machine: m4, input, rows: resultRows(run(s)) });

describe("compression findings", () => {
  const cells = ["dickens", "xml", "x-ray", "samba"].map((i) => cell(i));

  it("names the one fastest download over the whole range, with a time to stand on", () => {
    const f = ask(transferQuestion("download", 1), [cell("dickens")]);
    expect(f.title).toBe("zstd 9 gave the fastest download of the levels tested, at every bandwidth from 1 Mbps to 1 Gbps");
    expect(f.claim?.key).toBe("compression.download:zstd-9");
    expect(f.claim?.text).toMatch(/^To download dickens in Chrome, zstd 9 was fastest of the levels tested across 1 Mbps–1 Gbps: [\d.]+ ms at 100 Mbps \(Figure 1\)\.$/);
  });

  it("names each upload band's winner at its rounded crossover", () => {
    const f = ask(transferQuestion("upload", 2), [cell("dickens")]);
    // zstd 9 gives way to zstd 1 at 22.4 Mbps: each is named only where it leads by more than 3%.
    expect(f.claim?.text).toBe("To upload dickens in Chrome, use zstd 9 below ≈15 Mbps and zstd 1 above ≈30 Mbps; about the same between (Figure 2).");
    expect(f.title).toBe("The fastest upload of the levels tested went from zstd 9 to zstd 1 as bandwidth rose");
    expect(f.claim?.key).toBe("compression.upload:zstd-9>zstd-1");
  });

  it("claims a band only where both captures agree, and says about the same between", () => {
    // In the second capture zstd 9 compresses ten times slower, so zstd 1 takes over at about 2 Mbps instead of 22.
    const slow: Spec[] = specs.map((s) => (s[0] === "zstd" && s[1] === 9 ? [s[0], s[1], s[2], s[3], 4, s[5]] : s));
    const [a, b] = [cell("dickens"), cell("dickens", "Chrome", slow)];
    const bands = cellBands(a, "upload", [[b]]);
    expect(bands.map((x) => x.winner ?? "~")).toEqual(["zstd-9", "~", "zstd-1"]);
    expect(bands[1].near).toEqual(["zstd-9", "zstd-1"]);
    const f = askJoint(transferQuestion("upload", 2), [a], [[b]]);
    expect(f.claim?.text).toBe("To upload dickens in Chrome, use zstd 9 below ≈1.5 Mbps and zstd 1 above ≈30 Mbps; about the same between (Figure 2).");
    expect(wordCount(f.claim!.text)).toBeLessThanOrEqual(POINT_WORDS);
    // Either capture first: the same joint claim, so the gate keeps it.
    expect(askJoint(transferQuestion("upload", 2), [b], [[a]]).claim?.key).toBe(f.claim?.key);
  });

  it("never drops a bandwidth condition for storage: the upload point names every band and no storage cost", () => {
    // zstd 1 stores 21% more than zstd 9, but that belongs in Figure 2's table, not the point.
    const f = ask(transferQuestion("upload", 2), [cell("dickens")]);
    expect(f.claim?.text).toMatch(/zstd 9 below ≈\S+ Mbps and zstd 1 above ≈\S+ Mbps/);
    expect(f.claim?.text).not.toMatch(/stor|\$/);
  });

  it("drops the claim when the second capture never measured that cell", () => {
    // Chrome in capture 1, Firefox only in capture 2: nothing reproduces.
    const f = askJoint(transferQuestion("upload", 2), [cell("dickens")], [[cell("dickens", "Firefox")]]);
    expect(f.claim).toBeUndefined();
    expect(f.title).toBe(f.neutral);
  });

  it("drops the claim when two cells have different winners", () => {
    const fast: Spec[] = specs.map((s) => (s[0] === "zstd" && s[1] === 1 ? [s[0], s[1], 3.39, s[3], s[4], s[5]] : s));
    expect(ask(transferQuestion("upload", 2), [cell("dickens"), cell("xml", "Chrome", fast)]).claim).toBeUndefined();
  });

  it("keeps a claim with the same winners in every cell, scoped to all of them", () => {
    const f = ask(transferQuestion("upload", 2), [cell("dickens"), cell("xml")]);
    expect(f.claim?.text).toBe("To upload dickens and xml in Chrome, use zstd 9 below ≈15 Mbps and zstd 1 above ≈30 Mbps; about the same between (Figure 2).");
    expect(f.claim?.cells).toHaveLength(2);
  });

  it("says nothing when the leaders are about the same everywhere", () => {
    // zstd 9 and zstd 15 within 1% at every bandwidth.
    const twins: Spec[] = [
      ["zstd", 9, 3.4, 1400, 40, 120_000],
      ["zstd", 15, 3.41, 1400, 40, 120_000],
    ];
    const f = ask(transferQuestion("download", 1), [cell("dickens", "Chrome", twins)]);
    expect(f.claim).toBeUndefined();
    expect(f.title).toBe("Time to download and decompress one file, by bandwidth");
  });

  it("titles the code-size figure by what it measures, and states the range as the point", () => {
    const f = ask(codeSize(5), cells);
    expect(f.title).toBe("Download size of compression and decompression code");
    expect(f.claim?.text).toBe("The smallest library decoder is lz4_flex's at 9.00 kB, the largest zstd's at 120 kB (Figure 5).");
  });
});

/** Deflate decoders at level 6: three about-the-same fast ones, a middle one, two slow JavaScript ones. */
const deflate: Spec[] = [
  ["zune", null, 2.6, 730, 1, 14_000],
  ["zlibrs", 6, 2.62, 690, 30, 56_000],
  ["libdeflate", 6, 2.64, 660, 60, 35_000],
  ["miniz", 6, 2.63, 450, 25, 26_000],
  ["fflate", 6, 2.58, 230, 40, 12_000],
  ["pako", 6, 2.6, 215, 22, 10_000],
  ["zlibrs", 1, 2.2, 600, 200, 56_000],
];

describe("Deflate implementations", () => {
  const c = cell("dickens", "Chrome", deflate);

  it("puts decoders in tiers, a new one only past the stream effect", () => {
    const tiers = decoderTiers(c.rows, "deflate").map((t) => t.map((r) => r.family));
    expect(tiers).toEqual([["zune", "zlibrs", "libdeflate"], ["miniz"], ["fflate", "pako"]]);
  });

  it("claims the top tier against the next, never within it", () => {
    const f = ask(decodeImplementations("deflate", 3), [c]);
    expect(f.title).toBe("zune-inflate, zlib-rs and libdeflate decoded at least 1.47× faster than the rest");
    expect(f.title).not.toMatch(/about the same/);
    expect(f.claim?.text).toBe("For fast Deflate decoding, any of the top three will do: the encoder alone can reorder them, on dickens in Chrome (Figure 3).");
    expect(topTier(c.rows, "deflate")?.spread).toBeCloseTo(730 / 660, 2);
  });

  it("anchors each tier at its fastest decoder, without chaining", () => {
    // Each step is 1.18×, but 1000 → 610 is 1.64×: past the allowance from the anchor.
    const chain = cell("dickens", "Chrome", [
      ["zune", null, 2.6, 1000, 1, 14_000],
      ["zlibrs", 6, 2.6, 850, 30, 56_000],
      ["libdeflate", 6, 2.6, 720, 60, 35_000],
      ["miniz", 6, 2.6, 610, 25, 26_000],
    ]);
    expect(decoderTiers(chain.rows, "deflate").map((t) => t.map((r) => r.family))).toEqual([["zune", "zlibrs", "libdeflate"], ["miniz"]]);
    // The top tier's slowest is only 1.18× ahead of the next: no claim, neutral title.
    expect(STREAM_ALLOWANCE).toBe(1.44);
    expect(topTier(chain.rows, "deflate")).toBeUndefined();
    const f = ask(decodeImplementations("deflate", 3), [chain]);
    expect(f.claim).toBeUndefined();
    expect(f.title).toBe(f.neutral);
  });

  it("drops the tier claim when a replicate's top tier differs", () => {
    const rep = cell("dickens", "Chrome", deflate.map((s) => (s[0] === "miniz" ? [s[0], s[1], s[2], 640, s[4], s[5]] : s)));
    expect(ask(decodeImplementations("deflate", 3), [c], [[rep]]).claim).toBeUndefined();
  });
});

describe("bandwidth ranges in words", () => {
  it("says from and to, never a bare range after over", () => {
    expect(rangeText({ lo: 70, hi: 300 })).toBe("from ≈70 to 300 Mbps");
    expect(rangeText({ lo: 500, hi: null })).toBe("above ≈500 Mbps");
    expect(rangeText({ lo: null, hi: 2.5 })).toBe("below ≈2.5 Mbps");
  });
});
