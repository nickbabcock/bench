import { describe, expect, it } from "vitest";
import { ask, askReproduced, type MachineRef, POINT_WORDS, wordCount } from "@/lib/findings";
import type { Allocator } from "./allocators";
import {
  allocatorCalls,
  arenaCost,
  arenaPair,
  arenaTime,
  type AllocationCell,
  claimAllocators,
  editionDecisions,
  generalTime,
  globalDecision,
  TIME_NEUTRAL,
  roughShare,
  timeTitle,
} from "./findings";
import type { AllocationRun } from "./harness";
import type { ModuleSizes } from "./sizes";

const m4: MachineRef = { id: "m4pro-arm64", cpuModel: "Apple M4 Pro", arch: "arm64" };
const profile = { allocs: 990_000, grows: 270_000, shrinks: 0, frees: 990_000, bytes: 139_000_000 };
const result = (ms: number, pages: number, n = 20) => ({
  samples: Array.from({ length: n }, (_, i) => ms * (1 + (i % 3) * 0.002)),
  repetitions: 1,
  coldMs: ms * 2,
  pages: { baseline: 100, after: 100 + pages },
  profile,
  checksum: 7,
});
const run = (times: Record<Allocator, number>, pages: Record<Allocator, number>, n = 20): AllocationRun => ({
  id: 1,
  input: "xml",
  documents: { sizes: [734_535, 2_244], rejected: 0 },
  samples: n,
  fixedBatches: 3,
  startedAt: 0,
  endedAt: 0,
  checksumsMatch: true,
  results: Object.fromEntries((Object.keys(times) as Allocator[]).map((a) => [a, result(times[a], pages[a], n)])) as AllocationRun["results"],
});
const sizes: ModuleSizes = {
  gzipLevel: 9,
  brotliQuality: 11,
  modules: {
    dlmalloc: { file: "alloc_bg.wasm", raw: 45_948, gzip: 0, brotli: 16_435 },
    talc: { file: "alloc_talc_bg.wasm", raw: 40_615, gzip: 0, brotli: 14_716 },
    bumpalo: { file: "alloc_bumpalo_bg.wasm", raw: 53_297, gzip: 0, brotli: 18_660 },
    "bump-scope": { file: "alloc_bump_scope_bg.wasm", raw: 52_390, gzip: 0, brotli: 18_417 },
  },
};
const cell = (engine: string, r: AllocationRun): AllocationCell => ({ engine, machine: m4, input: null, run: r });
const data = (r: AllocationRun) => ({ cells: [cell("Chrome", r)], sizes });

// talc slower and growing fewer pages; the arenas alike, faster than dlmalloc and growing more.
const times = { dlmalloc: 6, talc: 7.8, bumpalo: 2.5, "bump-scope": 2.51 };
const pages = { dlmalloc: 20, talc: 17, bumpalo: 60, "bump-scope": 60 };

describe("allocation findings: main points", () => {
  it("states the global-allocator decision in time, pages and bytes, in at most 25 words", () => {
    const text = ask(globalDecision, data(run(times, pages))).claim!.text;
    // The point stands alone: the time with its size, the heap in bytes.
    expect(text).toBe("Replacing dlmalloc with talc: 30% more time, 192 KiB less heap and a 1.72 kB smaller download, in Chrome (Figure 1; table).");
    expect(text.split(" ").length).toBeLessThanOrEqual(25);
    const small = ask(globalDecision, data(run({ ...times, talc: 6.24 }, pages))).claim!.text;
    expect(small.split(" ").length).toBeLessThanOrEqual(25);
  });
  it("states a small effect by its number alone", () => {
    expect(ask(globalDecision, data(run({ ...times, talc: 6.24 }, pages))).claim?.text).toContain(": 4% more time,");
    expect(ask(globalDecision, data(run({ ...times, talc: 6.24 }, pages))).claim?.text).not.toContain("a small");
  });
  it("words the arena decision by the global allocator's rule, alike or not", () => {
    // Arenas alike: still a point (the download differs), as talc's is with about the same time; no engine keeps one and drops the other.
    expect(ask(arenaPair, data(run(times, pages))).claim?.text).toBe(
      "Replacing bumpalo with bump-scope: about the same time, about the same heap and a 0.24 kB smaller download, in Chrome (Figure 1; table).",
    );
    expect(ask(arenaPair, data(run({ ...times, "bump-scope": 2.6 }, pages))).claim?.text).toBe(
      "Replacing bumpalo with bump-scope: 4% more time, about the same heap and a 0.24 kB smaller download, in Chrome (Figure 1; table).",
    );
  });
  it("holds a claim back until a second capture reproduces it", () => {
    const d = data(run(times, pages));
    expect(askReproduced(globalDecision, d, []).claim).toBeUndefined();
    expect(askReproduced(globalDecision, d, [d]).claim?.key).toBe("allocation.decision:slower:fewer");
  });
  it("never reads too few rounds as the same", () => {
    // talc a tenth of dlmalloc's time, but five rounds: no CI, so no comparison.
    const r = run({ ...times, talc: 0.6, "bump-scope": 25 }, pages, 5);
    expect(ask(globalDecision, data(r)).claim?.text).toContain("too few rounds to compare time");
    expect(ask(globalDecision, data(r)).claim?.text).not.toContain("about the same time");
    expect(ask(arenaPair, data(r)).claim?.text).toContain("too few rounds to compare time");
    expect(ask(generalTime, data(r)).claim).toBeUndefined();
    expect(arenaCost([r], undefined, sizes)).not.toMatch(/time per document/);
  });
});

describe("allocation findings: what an arena costs and buys", () => {
  it("rounds plainly, in the whole application's time", () => {
    const r = run(times, pages);
    expect(arenaCost([r], [[r]], sizes)).toBe(
      "Against dlmalloc alone, with one arena reset after each document, the whole application took about 60% less time per document, the permanent heap grew about 2.5 MiB more and the download was about 2 kB larger (Figure 1; table).",
    );
  });
  it("leaves the time out until a second capture agrees", () => {
    expect(arenaCost([run(times, pages)], [], sizes)).toBe(
      "Against dlmalloc alone, with one arena reset after each document, the permanent heap grew about 2.5 MiB more and the download was about 2 kB larger (Figure 1; table).",
    );
  });
  it("names common fractions", () => {
    expect(roughShare(0.21)).toBe("about a fifth");
    expect(roughShare(0.26)).toBe("about a quarter");
    expect(roughShare(0.41)).toBe("about 40%");
  });
});

describe("allocation findings: Figure 1, within a class", () => {
  it("never compares across classes", () => {
    const g = ask(generalTime, data(run(times, pages)));
    const a = ask(arenaTime, data(run(times, pages)));
    expect(g.title).toBe("talc took 30% more time per document than dlmalloc in Chrome");
    expect(a.claim).toBeUndefined();
    expect(timeTitle(g, a)).toBe(g.title);
    expect(timeTitle(a, a)).toBe(TIME_NEUTRAL);
    expect(claimAllocators(g)).toEqual(["talc"]);
  });
  it("counts allocator calls and claims no share of time", () => {
    const text = allocatorCalls(run(times, pages));
    expect(text).toContain("990,000 allocations");
    expect(text).not.toMatch(/at least|share/);
  });
});

describe("allocation findings: engines", () => {
  it("pairs by round, so a consistent small gap is a claim", () => {
    // talc 3.5% faster in every round: paired, that is a claim even where unpaired ranges would overlap.
    const r = run({ ...times, talc: 6 * 0.965 }, pages);
    expect(ask(generalTime, data(r)).title).toBe("talc took 3.5% less time per document than dlmalloc in Chrome");
  });
  it("gates a within-class claim per engine, not just somewhere", () => {
    const chrome = cell("Chrome", run({ ...times, talc: 5 }, pages));
    const firefox = cell("Firefox", run(times, pages));
    const fasterChrome = { cells: [chrome, { ...firefox, run: run({ ...times, talc: 6 }, pages) }], sizes };
    const fasterFirefox = { cells: [{ ...chrome, run: run({ ...times, talc: 6 }, pages) }, cell("Firefox", run({ ...times, talc: 5 }, pages))], sizes };
    expect(ask(generalTime, fasterChrome).claim?.key).toBe("allocation.time.general:talc:faster");
    expect(askReproduced(generalTime, fasterChrome, [fasterFirefox]).claim).toBeUndefined();
  });
});

describe("edition main points", () => {
  const t = (talc: number, bs = 2.6) => run({ dlmalloc: 6, talc, bumpalo: 2.5, "bump-scope": bs }, { dlmalloc: 20, talc: 24, bumpalo: 60, "bump-scope": 60 });
  const setting = (engine: string, r: AllocationRun, rep: AllocationRun = r) => ({ cell: cell(engine, r), replicates: [cell(engine, rep)] });
  const settings = [setting("Chrome", t(6.02)), setting("Firefox", t(5.7)), setting("Safari", t(6.01, 2.51))];

  it("names the settings that disagree on time instead of averaging them, within 25 words", () => {
    const [general, arena] = editionDecisions(settings, sizes);
    expect(general.text).toBe("talc vs dlmalloc: 256 KiB more heap, 1.72 kB smaller download; about the same time, except 5% less in Firefox (Figure 1; table).");
    expect(arena.text).toBe("bump-scope vs bumpalo: the same heap, 0.24 kB smaller download; 4% more time in Chrome and Firefox, about the same in Safari (Figure 1; table).");
    for (const p of [general, arena]) {
      expect(wordCount(p.text)).toBeLessThanOrEqual(POINT_WORDS);
    }
  });

  it("is the same whatever setting the page shows first", () => {
    expect(editionDecisions([...settings].reverse(), sizes)).toEqual(editionDecisions(settings, sizes));
    expect(editionDecisions([settings[1], settings[0], settings[2]], sizes).map((p) => p.text)).toEqual(editionDecisions(settings, sizes).map((p) => p.text));
  });

  it("says all browsers when every one agrees, and keeps a setting whose captures disagree apart", () => {
    const same = ["Chrome", "Firefox", "Safari"].map((e) => setting(e, t(5.7)));
    expect(editionDecisions(same, sizes)[0].text).toBe("talc vs dlmalloc: 256 KiB more heap, 1.72 kB smaller download; 5% less time in all 3 browsers (Figure 1; table).");
    const unsettled = [setting("Chrome", t(5.7)), setting("Firefox", t(5.7), t(6.3))];
    expect(editionDecisions(unsettled, sizes)[0].text).toMatch(/; 5% less time in Chrome, unsettled in Firefox \(Figure 1; table\)\.$/);
  });
});
