import { describe, expect, it } from "vitest";
import { configId, type Family } from "./codecs";
import { resultRows } from "./results";
import { editionCells } from "./release";
import { cellLines } from "./findings";
import {
  bandLead,
  bandsOf,
  crossing,
  dollars,
  envelope,
  GRID,
  type Line,
  rankAt,
  roundFine,
  roundNice,
  roundSig,
  S3_STORAGE,
  smallestOutput,
  storagePerTB,
  storageOf,
  timeAt,
  transferLines,
  UNCOMPRESSED,
} from "./transfer";
import type { CompressionRun } from "./types";

const line = (id: string, fixedMs: number, bytes: number): Line => ({ id, label: id, fixedMs, bytes });

describe("the time model", () => {
  it("adds the fixed time to bytes ÷ bandwidth, with 1 Mbps = 10⁶ bits/s", () => {
    // 1 MB at 8 Mbps is one second.
    expect(timeAt(line("a", 0, 1_000_000), 8)).toBeCloseTo(1000, 9);
    expect(timeAt(line("a", 25, 1_000_000), 80)).toBeCloseTo(125, 9);
  });

  it("builds download lines from decompression, upload lines from compression, and adds Uncompressed", () => {
    const run: CompressionRun = {
      id: 1,
      filename: "dickens",
      synthetic: true,
      bytes: 1_000_000,
      samples: 3,
      startedAt: 0,
      status: "done",
      configs: [
        { spec: { id: configId("zstd", 3), family: "zstd" as Family, level: 3 }, size: 300_000, roundTrip: true, encodeMs: [9, 30, 10], decodeMs: [2, 1, 3] },
        { spec: { id: configId("zune", null), family: "zune" as Family, level: null }, size: 400_000, roundTrip: true, encodeMs: [], decodeMs: [4, 4, 4] },
        { spec: { id: configId("pako", 6), family: "pako" as Family, level: 6 }, size: 350_000, roundTrip: false, encodeMs: [5], decodeMs: [5] },
      ],
    };
    const rows = resultRows(run);
    const down = transferLines(rows, "download");
    expect(down.map((l) => [l.id, l.fixedMs, l.bytes])).toEqual([
      ["zstd-3", 2, 300_000],
      ["zune", 4, 400_000],
      [UNCOMPRESSED, 0, 1_000_000],
    ]);
    // The median time, not the mean; a decode-only library has no upload.
    expect(transferLines(rows, "upload").map((l) => [l.id, l.fixedMs])).toEqual([
      ["zstd-3", 10],
      [UNCOMPRESSED, 0],
    ]);
  });
});

describe("the envelope", () => {
  // Fewer bytes cost more fixed time: each is fastest somewhere.
  const lines = [line("high", 400, 2_000_000), line("mid", 40, 3_000_000), line("fast", 5, 5_000_000), line("raw", 0, 10_000_000), line("never", 500, 4_000_000)];

  it("finds where two lines cross, exactly", () => {
    const b = crossing(lines[0], lines[1])!;
    // 8 Mb of difference over 360 ms: 22.2 Mbps.
    expect(b).toBeCloseTo(8e6 / (1000 * 360), 9);
    expect(timeAt(lines[0], b)).toBeCloseTo(timeAt(lines[1], b), 9);
    // A line with more bytes and more fixed time never crosses below.
    expect(crossing(lines[1], lines[4])).toBeUndefined();
  });

  it("is the fastest line at every bandwidth, with segments meeting at crossovers", () => {
    const env = envelope(lines);
    expect(env.map((s) => s.line.id)).toEqual(["high", "mid", "fast"]);
    expect(env[0].from).toBe(1);
    expect(env.at(-1)!.to).toBe(1000);
    env.slice(1).forEach((s, i) => expect(s.from).toBe(env[i].to));
    expect(env.slice(1).map((s) => s.from)).toEqual([crossing(lines[0], lines[1]), crossing(lines[1], lines[2])]);
    for (const b of [1, 3.7, 22, 23, 150, 459, 1000]) {
      const seg = env.find((s) => b >= s.from && b <= s.to)!;
      expect(timeAt(seg.line, b)).toBeCloseTo(rankAt(lines, b)[0].ms, 9);
    }
  });

  it("reaches Uncompressed when its line is lowest", () => {
    // Compression that costs 50 ms to save half: uncompressed wins above 80 Mbps.
    const env = envelope([line("slow", 50, 500_000), line("raw", 0, 1_000_000)]);
    expect(env.map((s) => s.line.id)).toEqual(["slow", "raw"]);
    expect(env[1].from).toBeCloseTo(80, 9);
  });
});

describe("bands from captures", () => {
  it("rounds to the 1-2-5 sequence, or the finer 1-1.5-2-3-5-7 one where that is more than 1.3× off", () => {
    expect([1.1, 13, 22.4, 249].map((x) => roundNice(x))).toEqual([1, 10, 20, 200]);
    // 15 → 20 and 32 → 50 would be 1.33× and 1.55× off.
    expect([15, 32.2, 335, 700].map((x) => roundNice(x))).toEqual([15, 30, 300, 700]);
    expect([1.1, 3, 13, 200].map((x) => roundNice(x, "up"))).toEqual([1.5, 3, 15, 200]);
    expect([1.1, 3, 13, 200].map((x) => roundNice(x, "down"))).toEqual([1, 3, 10, 200]);
  });

  // high wins clearly below 20.2 Mbps, mid above 24.3; between, mid is ahead by under 3%.
  const pair = [line("high", 400, 2_000_000), line("mid", 40, 3_000_000)];

  it("names a winner only where the runner-up takes more than 3% longer", () => {
    const bands = bandsOf([pair]);
    expect(bands.map((b) => b.winner ?? "~")).toEqual(["high", "~", "mid"]);
    // The exact edges are where the lead reaches 3%: 7520 / 372 and 8720 / 358.8 Mbps.
    expect(bands[0].to).toBeCloseTo(7520 / 372, 6);
    expect(bands[2].from).toBeCloseTo(8720 / 358.8, 6);
    expect(timeAt(pair[1], bands[0].to) / timeAt(pair[0], bands[0].to)).toBeCloseTo(1.03, 6);
    expect([...bands[1].near].sort()).toEqual(["high", "mid"]);
  });

  it("states an edge at the nearest nice value only inside the band, where the gate holds; else inward", () => {
    const [high, tie, mid] = bandsOf([pair]);
    // 20.2 → 20: high is fastest at 20.
    expect([high.lo, high.hi]).toEqual([null, 20]);
    // 24.3 → 20 would claim mid where it is 3.3% slower than high, so the edge rounds inward, to 30 (50 is over 1.3× off).
    expect(timeAt(pair[1], 20) / timeAt(pair[0], 20)).toBeGreaterThan(1.03);
    expect([mid.lo, mid.hi]).toEqual([30, null]);
    expect([tie.lo, tie.hi]).toEqual([20, 30]);
  });

  it("calls a near tie about the same everywhere", () => {
    expect(bandsOf([[line("x", 10, 1_000_000), line("y", 10, 1_010_000)]])).toEqual([{ from: GRID[0], to: GRID.at(-1), lo: null, hi: null, near: ["x", "y"] }]);
  });

  it("needs the same winner by more than 3% in every capture", () => {
    // In the second capture "high" is ten times slower to start, so "mid" takes over at about 2 Mbps instead of 22.
    const slow = [line("high", 4000, 2_000_000), line("mid", 40, 3_000_000)];
    const bands = bandsOf([pair, slow]);
    expect(bands.map((x) => x.winner ?? "~")).toEqual(["high", "~", "mid"]);
    expect(bands[0].to).toBeLessThan(2.2);
    expect(bands[2].from).toBeGreaterThan(24);
    expect(bandsOf([slow, pair]).map((x) => x.winner ?? "~")).toEqual(["high", "~", "mid"]);
  });

  it("never widens a winner over bandwidths where it leads by 3% or less", () => {
    // "edge" leads "high" by under 3% below about 2 Mbps: about the same there, not "high".
    const bands = bandsOf([[line("edge", 600, 1_960_000), ...pair]]);
    expect(bands[0].winner).toBeUndefined();
    expect(bands[0].near).toContain("edge");
    expect(bands[0].near).toContain("high");
    for (const b of bands.filter((x) => x.winner)) {
      for (const g of GRID.filter((x) => x > b.from && x < b.to)) {
        const [a, n] = rankAt([line("edge", 600, 1_960_000), ...pair], g);
        expect(a.line.id).toBe(b.winner);
        expect(n.ms / a.ms).toBeGreaterThan(1.03);
      }
    }
  });
});

describe("the envelope at the left edge", () => {
  it("starts with the line that wins just above 1 Mbps when two tie there", () => {
    // Both take 16.4 s at 1 Mbps; above it, the one with less fixed time is faster.
    const env = envelope([line("slow-start", 400, 2_000_000), line("fast-start", 40, 2_045_000)]);
    expect(env.map((s) => s.line.id)).toEqual(["fast-start"]);
  });
});

describe("storage cost", () => {
  it("prices 1 TB of original data stored compressed, one copy, one month, at $0.023 per GiB (2³⁰ bytes)", () => {
    expect(S3_STORAGE.perGiBMonth).toBe(0.023);
    // Uncompressed: 10¹² bytes is 931.3 GiB, $21.42 a month.
    expect(storagePerTB(1, 1)).toBeCloseTo((1e12 / 2 ** 30) * 0.023, 12);
    expect(dollars(storagePerTB(1, 1))).toBe("$21.42");
    // Only the ratio matters, not the sample file's size.
    expect(storagePerTB(3_057_963, 10_192_446)).toBeCloseTo(storagePerTB(3_057_963 * 7, 10_192_446 * 7), 12);
  });

  const lines = [line("zstd-1", 25, 4_261_734), line("zstd-3", 60, 3_663_504), line("zstd-15", 1889, 3_057_963), line("brotli-9", 3000, 3_188_443), line(UNCOMPRESSED, 0, 10_192_446)];

  it("compares a configuration with another one, never by default with the smallest", () => {
    const k = storageOf(lines, "zstd-1", "zstd-3")!;
    expect(dollars(k.cost)).toBe("$8.96");
    expect(k.vs?.line.id).toBe("zstd-3");
    expect(k.vs!.larger).toBeCloseTo(4_261_734 / 3_663_504 - 1, 12);
    expect(Math.round(k.vs!.larger * 100)).toBe(16);
    expect(dollars(k.vs!.extra)).toBe("$1.26");
    expect(storageOf(lines, "zstd-1")!.vs).toBeUndefined();
    // Uncompressed keeps the original bytes.
    expect(dollars(storageOf(lines, UNCOMPRESSED)!.cost)).toBe("$21.42");
    expect(storageOf(lines, UNCOMPRESSED, "zstd-1")!.vs!.larger).toBeCloseTo(10_192_446 / 4_261_734 - 1, 12);
    expect(storageOf(lines, "missing")).toBeUndefined();
  });

  it("finds the smallest output, overall or among tied options", () => {
    expect(smallestOutput(lines)?.id).toBe("zstd-15");
    expect(smallestOutput(lines, ["zstd-1", "zstd-3"])?.id).toBe("zstd-3");
    expect(smallestOutput(lines, [UNCOMPRESSED])).toBeUndefined();
  });

  it("writes dollars to the cent below $100, whole above", () => {
    expect([0.0475, 0.98, 12.4, 123.4].map(dollars)).toEqual(["$0.05", "$0.98", "$12.40", "$123"]);
  });
});

describe("stated edges against the gate", () => {
  /** The gate at `b`: the same winner in every capture, the runner-up more than 3% slower in each. */
  const gated = (captures: readonly (readonly Line[])[], b: number) => {
    const ws = captures.map((ls) => {
      const [a, n] = rankAt(ls, b);
      return n.ms / a.ms > 1.03 ? a.line.id : undefined;
    });
    return ws.every((w) => w === ws[0]) ? ws[0] : undefined;
  };

  it("holds at every stated edge and everywhere between, in every reference cell and capture", () => {
    for (const c of editionCells()) {
      for (const sc of ["download", "upload"] as const) {
        const captures = cellLines(
          c.cell,
          sc,
          c.replicates.map((r) => [r]),
        );
        for (const b of bandsOf(captures).filter((x) => x.winner)) {
          const [lo, hi] = [b.lo ?? 1, b.hi ?? 1000];
          expect(lo).toBeLessThan(hi);
          // Inside the exact band.
          expect(lo).toBeGreaterThanOrEqual(b.from * (1 - 1e-9));
          expect(hi).toBeLessThanOrEqual(b.to * (1 + 1e-9));
          const pts = [lo, ...Array.from({ length: 49 }, (_, i) => lo * (hi / lo) ** ((i + 1) / 50)), hi];
          for (const x of pts) {
            expect(gated(captures, x)).toBe(b.winner);
          }
        }
      }
    }
  });

  it("never states Firefox/xml upload's zstd 3 from ≈30 Mbps, where zstd 9 is 1.2% faster", () => {
    const c = editionCells().find((x) => x.cell.input === "xml" && x.cell.engine.startsWith("Firefox"))!;
    const captures = cellLines(
      c.cell,
      "upload",
      c.replicates.map((r) => [r]),
    );
    const z3 = bandsOf(captures).find((b) => b.winner === "zstd-3")!;
    expect(z3.lo).toBeGreaterThan(z3.from);
    expect(z3.lo).not.toBe(30);
    expect(rankAt(captures[0], 30)[0].line.id).toBe("zstd-9");
  });

  it("states a narrow band with finer steps rather than dropping it", () => {
    expect([71.05, 1.32].map((x) => roundFine(x, "up"))).toEqual([80, 1.5]);
    expect([134.16, 1.97].map((x) => roundFine(x, "down"))).toEqual([120, 1.5]);
    expect([1.97, 3.05].map((x, i) => roundSig(x, i ? "up" : "down"))).toEqual([1.9, 3.1]);
  });

  it("gives no about-the-same band whose stated edges meet, such as a sliver at [1.000–1.007]", () => {
    // "lead" is fastest by over 3% from 1.007 Mbps; below it "other" is within 3% of it.
    const lead = line("lead", 0, 1_000_000);
    const other = line("other", 397.2, 980_000);
    const captures = [[lead, other]];
    const bands = bandsOf(captures);
    const first = bands.find((b) => b.winner)!;
    expect(first.from).toBeGreaterThan(1);
    expect(first.from).toBeLessThan(1.5);
    for (const b of bands) {
      // Every band states a stretch: both ends null only when it is the only band.
      expect(b.lo === b.hi && (b.lo !== null || bands.length > 1)).toBe(false);
    }
  });

  it("measures a winner's lead over the runner-up across the band and every capture", () => {
    const pair = [line("high", 400, 2_000_000), line("mid", 40, 3_000_000)];
    const [high, tie] = bandsOf([pair]);
    const lead = bandLead([pair], high)!;
    expect(lead.min).toBeCloseTo(0.03, 6);
    expect(lead.max).toBeCloseTo(timeAt(pair[1], 1) / timeAt(pair[0], 1) - 1, 9);
    expect(bandLead([pair], tie)).toBeUndefined();
  });
});
