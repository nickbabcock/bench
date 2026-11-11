import { describe, expect, it } from "vitest";
import { ask, askReproduced, type MachineRef } from "@/lib/findings";
import type { ResultRow } from "./harness";
import { editionFindings, figureTitle, memory64Memory, memory64Time, type Memory64Cell, NEUTRAL_TITLE } from "./findings";

const m4: MachineRef = { id: "m4pro-arm64", cpuModel: "Apple M4 Pro", arch: "arm64" };
const row = (r: number, mem64 = 100 << 20, n = 20): ResultRow => ({
  id: 1,
  workload: "editor",
  params: { entities: 100_000 },
  repetitions: 1,
  frames: 1,
  samples: { wasm32: Array.from({ length: n }, (_, i) => 10 + (i % 3) * 0.05), wasm64: Array.from({ length: n }, (_, i) => (10 + (i % 3) * 0.05) * r) },
  memoryBytes: { wasm32: 100 << 20, wasm64: mem64 },
  pointerWidths: { wasm32: 4, wasm64: 8 },
  checksumsMatch: true,
  startedAt: 0,
  endedAt: 0,
});
const cell = (engine: string, r: number, mem?: number): Memory64Cell => ({ engine, machine: m4, input: null, row: row(r, mem) });

describe("memory64 findings", () => {
  it("splits time by engine where engines disagree", () => {
    const f = ask(memory64Time, [cell("Chrome", 1.2), cell("Firefox", 1.01)]);
    expect(f.title).toBe("In Chrome, wasm64 took 20% more time than wasm32; in Firefox, about the same");
    // Read first, so it stands alone: the size, then what it means.
    expect(f.claim?.text).toBe("wasm64 took 20% more time than wasm32 in Chrome but about the same in Firefox: choose it only for more than 4 GiB (Figure 1).");
    expect(ask(memory64Time, [cell("Chrome", 0.8), cell("Firefox", 1.01)]).claim?.text).toBe(
      "wasm64 took 20% less time than wasm32 in Chrome but about the same in Firefox; one workload, cause not investigated (Figure 1).",
    );
    expect(f.claim?.key).toBe("memory64.time:slower");
  });
  it("states one clause when every engine agrees, small effects by their number", () => {
    expect(ask(memory64Time, [cell("Chrome", 0.96), cell("Firefox", 0.96)]).title).toBe("wasm64 took 4% less time than wasm32 in Chrome and Firefox");
  });
  it("is neutral when within the threshold", () => {
    expect(ask(memory64Time, [cell("Chrome", 1.02)]).title).toBe("wasm64 ÷ wasm32 time");
  });
  it("claims memory beyond a page and 3%", () => {
    const f = ask(memory64Memory, [cell("Chrome", 1, 125 << 20), cell("Firefox", 1, 125 << 20)]);
    expect(f.title).toBe("wasm64 peaked 25% higher than wasm32 in Chrome and Firefox");
    expect(f.claim?.text).toBe("wasm64 peaked at 125 MiB, 25 MiB more than wasm32's 100 MiB, in Chrome and Firefox (Figure 1).");
  });
  it("joins both claims in Figure 1's title, or falls back to neutral", () => {
    const t = ask(memory64Time, [cell("Chrome", 1.2)]);
    const m = ask(memory64Memory, [cell("Chrome", 1, 125 << 20)]);
    expect(figureTitle(t, m)).toBe("wasm64 took 20% more time and peaked 25% higher than wasm32 in Chrome");
    expect(figureTitle(ask(memory64Time, [cell("Chrome", 1.01)]), ask(memory64Memory, [cell("Chrome", 1)]))).toBe(NEUTRAL_TITLE);
    const cells = [cell("Chrome", 0.87, 125 << 20), cell("Firefox", 1, 125 << 20)];
    expect(figureTitle(ask(memory64Time, cells), ask(memory64Memory, cells), cells)).toBe(
      "In Chrome, wasm64 took 13% less time than wasm32; in Firefox, about the same; its peak memory was 25% higher in both",
    );
  });
  it("gates memory per engine: Chrome-only then Firefox-only does not reproduce", () => {
    const chromeOnly = [cell("Chrome", 1, 120 << 20), cell("Firefox", 1)];
    const firefoxOnly = [cell("Chrome", 1), cell("Firefox", 1, 120 << 20)];
    expect(ask(memory64Memory, chromeOnly).claim?.key).toBe("memory64.memory:higher");
    expect(askReproduced(memory64Memory, chromeOnly, [firefoxOnly]).claim).toBeUndefined();
    expect(askReproduced(memory64Memory, chromeOnly, [chromeOnly]).title).toBe("wasm64 peaked 20% higher than wasm32 in Chrome");
  });
  it("gates time per engine too", () => {
    const chromeOnly = [cell("Chrome", 0.8), cell("Firefox", 1)];
    const firefoxOnly = [cell("Chrome", 1), cell("Firefox", 0.8)];
    expect(askReproduced(memory64Time, chromeOnly, [firefoxOnly]).claim).toBeUndefined();
  });
  it("never reads too few rounds as about the same", () => {
    const few: Memory64Cell = { engine: "Firefox", machine: m4, input: null, row: row(0.5, undefined, 5) };
    const f = ask(memory64Time, [cell("Chrome", 0.8), few]);
    expect(f.title).toBe("In Chrome, wasm64 took 20% less time than wasm32; in Firefox, too few rounds to compare");
    expect(ask(memory64Time, [few]).claim).toBeUndefined();
  });
});

describe("memory64 edition main points", () => {
  const setting = (engine: string, machine: MachineRef, r: number) => ({ engine, machine, run: row(r), replicates: [row(r)] });
  const settings = [setting("Chrome", m4, 1.2), setting("Firefox", m4, 1.01)];

  it("read every engine, whatever the page shows first", () => {
    const texts = (ss: typeof settings) => editionFindings(ss).map((f) => f.claim?.text);
    expect(texts([...settings].reverse())).toEqual(texts(settings));
    expect(texts(settings)[0]).toBe("wasm64 took 20% more time than wasm32 in Chrome but about the same in Firefox: choose it only for more than 4 GiB (Figure 1).");
  });

  it("match the shown machine's findings when there is one machine", () => {
    const one = settings.slice(0, 2);
    const cells = one.map((s) => ({ engine: s.engine, machine: s.machine, input: null, row: s.run }));
    expect(editionFindings(one).map((f) => f.claim?.text)).toEqual([memory64Time, memory64Memory].map((q) => askReproduced(q, cells, [cells]).claim?.text));
  });

  it("gate setting by setting: one engine missing a repeat doesn't hide the others", () => {
    const missing = [setting("Chrome", m4, 0.8), { ...setting("Firefox", m4, 0.8), replicates: [] }];
    const [time] = editionFindings(missing);
    expect(time.claim?.cells?.map((c) => c.engine)).toEqual(["Chrome"]);
  });

  it("state the deterministic memory point without any repeat", () => {
    const none = [{ ...setting("Chrome", m4, 1), run: row(1, 120 << 20), replicates: [] }];
    const [time, memory] = editionFindings(none);
    expect(time.claim).toBeUndefined();
    expect(memory.claim?.key).toBe("memory64.memory:higher");
  });
});
