import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { driftFails, type Edition, mergeSubjects, repeatDrift, rowsFor, sampleMedians, TIMING_KEYS, validateEdition } from "@/lib/edition";
import { withheldNote } from "@/lib/findings";
import { allocationCaptures } from "./allocation";
import { buildCaptures } from "./build";
import { compressionCaptures } from "./compression";
import { facets, select, withheld } from "./index";
import { memory64Captures } from "./memory64";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Edition;

/** A copy of a capture with every sample (the arrays the drift rule reads) multiplied by `k`, as a slowed run would be. */
const slowed = <E extends Edition>(e: E, k: number, repeat = 2): E => {
  const scale = (x: unknown): unknown =>
    Array.isArray(x) ? (x.length >= 5 && x.every((v) => typeof v === "number") ? x.map((v: number) => v * k) : x.map(scale)) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([key, v]) => [key, scale(v)])) : x;
  return { ...e, repeat: { index: repeat, of: 2 }, raw: scale(e.raw) };
};

/** A copy of a capture with only its timing arrays (under `TIMING_KEYS`) multiplied by `k`. */
const timingsSlowed = <E extends Edition>(e: E, k: number, repeat = 2): E => {
  const scale = (x: unknown, timing: boolean): unknown =>
    Array.isArray(x)
      ? x.length >= 5 && x.every((v) => typeof v === "number")
        ? timing
          ? x.map((v: number) => v * k)
          : x
        : x.map((v) => scale(v, timing))
      : x && typeof x === "object"
        ? Object.fromEntries(Object.entries(x).map(([key, v]) => [key, scale(v, timing || TIMING_KEYS.has(key))]))
        : x;
  return { ...e, repeat: { index: repeat, of: 2 }, raw: scale(e.raw, false) };
};

const sambaSafari = read("./compression/2026-11-08/m4pro-arm64/safari-samba.json");
const sambaSafari2 = read("./compression/2026-11-08/m4pro-arm64/safari-samba.repeat-2.json");
const sambaChrome = read("./compression/2026-11-08/m4pro-arm64/chrome-samba.json");
const sambaChrome2 = read("./compression/2026-11-08/m4pro-arm64/chrome-samba.repeat-2.json");
const xmlSafari = read("./compression/2026-11-08/m4pro-arm64/safari-xml.json");
const xmlSafari2 = read("./compression/2026-11-08/m4pro-arm64/safari-xml.repeat-2.json");

describe("drift gate", () => {
  it("passes the recaptured Safari samba pair", () => {
    const d = repeatDrift(sambaSafari.raw, sambaSafari2.raw);
    expect(driftFails(d)).toBe(false);
    expect(withheld([sambaSafari, sambaSafari2, sambaChrome, sambaChrome2])).toEqual([]);
  });

  it("withholds a setting whose repeat ran 5.4× slower, everywhere", () => {
    const slow = slowed(sambaSafari, 5.4);
    const d = repeatDrift(sambaSafari.raw, slow.raw);
    expect(d.factor).toBeCloseTo(1 / 5.4, 6);
    expect(d.outliers).toBe(1);
    expect(driftFails(d)).toBe(true);

    const all = [sambaSafari, slow, sambaChrome, sambaChrome2, xmlSafari, xmlSafari2];
    const w = withheld(all);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ browser: "safari", name: "Safari", input: "samba", machine: "m4pro-arm64", captures: 2 });
    expect(withheldNote(w)).toBe("Safari's two captures of samba disagreed (one ran 5.4× slower), so Safari is not shown for samba.");

    // select() offers nothing for it; the other settings are untouched.
    expect(select(all, { browser: "safari", input: "samba" })).toEqual({ primary: [], replicates: [] });
    expect(select(all, { browser: "safari", input: "samba", includeWithheld: true }).primary).toEqual([sambaSafari]);
    expect(select(all, { browser: "chrome", input: "samba" }).primary).toEqual([sambaChrome]);
    expect(select(all, { browser: "safari", input: "xml" }).primary).toEqual([xmlSafari]);
    // Safari stays a facet (it has xml); samba stays an input (Chrome has it).
    expect(facets(all).browsers.sort()).toEqual(["chrome", "safari"]);
    expect(select(all, { input: "samba" }).primary.map((e) => e.browser.id)).toEqual(["chrome"]);
    // Only Safari had samba: the input is no longer offered.
    expect(facets([sambaSafari, slow, xmlSafari, xmlSafari2]).inputs).toEqual(["xml"]);
  });

  it("withholds when a few series moved by more than 1.5×, even if the overall factor holds", () => {
    const configs = (sambaSafari.raw as { configs: { decodeMs: number[] }[] }).configs;
    const n = Math.ceil(configs.length * 0.1);
    const raw = { ...(sambaSafari.raw as object), configs: configs.map((c, i) => (i < n ? { ...c, decodeMs: c.decodeMs.map((v) => v * 2) } : c)) };
    const partly = { ...sambaSafari, repeat: { index: 2, of: 2 }, raw };
    const d = repeatDrift(sambaSafari.raw, partly.raw);
    expect(d.factor).toBeGreaterThan(1 / 1.25);
    expect(d.outliers).toBeGreaterThan(0.05);
    expect(withheld([sambaSafari, partly])).toHaveLength(1);
  });

  it("reads only timing arrays, not metadata such as document sizes or zstd parameters", () => {
    const alloc = read("./allocation/2026-11-08/m4pro-arm64/chrome.json");
    expect([...sampleMedians(alloc.raw).keys()].sort()).toEqual(["bump-scope", "bumpalo", "dlmalloc", "talc"].map((a) => `.results.${a}.samples`));
    expect([...sampleMedians(sambaChrome.raw).keys()].some((k) => k.includes("zstdParams"))).toBe(false);
  });

  it("withholds a uniform 1.27× slowdown of every allocation timing", () => {
    const chrome = read("./allocation/2026-11-08/m4pro-arm64/chrome.json");
    const slow = timingsSlowed(chrome, 1.27);
    const d = repeatDrift(chrome.raw, slow.raw);
    expect(d.factor).toBeCloseTo(1 / 1.27, 6);
    expect(driftFails(d)).toBe(true);
    expect(withheld([chrome, slow])).toEqual([expect.objectContaining({ browser: "chrome", machine: "m4pro-arm64" })]);
  });

  it("ignores a stale stored repeatDrift and recomputes from raw", () => {
    const stale = { ...sambaSafari, repeatDrift: { factor: 0.2, outliers: 0.9 } };
    expect(withheld([stale, sambaSafari2])).toEqual([]);
  });
});

describe("reference edition 2026-11-08", () => {
  it("withholds nothing after the Safari recapture", () => {
    const all = { compression: compressionCaptures(), allocation: allocationCaptures(), memory64: memory64Captures(), build: buildCaptures() };
    for (const bench of Object.keys(all) as (keyof typeof all)[]) {
      expect(all[bench].length, bench).toBeGreaterThan(0);
      expect(withheld(bench, { edition: "2026-11-08" }), bench).toEqual([]);
    }
  });
});

describe("merging a build subject subset (capture.mjs --subjects)", () => {
  type Row = { subject: string; samples: Record<string, number[]> };
  const base = read("./build/2026-11-08/m4pro-arm64/chrome.json") as Edition<Row[]>;
  const other = read("./build/2026-11-08/m4pro-arm64/chrome.repeat-2.json") as Edition<Row[]>;
  const subjects = ["zstd-decode", "alloc"];
  const scale = (r: Row, k: number): Row => ({ ...r, samples: Object.fromEntries(Object.entries(r.samples).map(([v, xs]) => [v, xs.map((x) => x * k)])) });
  const part = {
    ...base,
    capturedAt: "2026-11-09T10:00:00.000Z",
    endedAt: "2026-11-09T10:20:00.000Z",
    browser: { ...base.browser, version: "157.0.1" },
    commit: { sha: "f".repeat(40), dirty: false },
    params: { ...base.params, captured: subjects },
    artifacts: base.artifacts.map((a) => (a.name.startsWith("variants/zstd_read/") ? { ...a, sha256: "a".repeat(64) } : a.name.startsWith("variants/lz4/") ? { ...a, sha256: "b".repeat(64) } : a)),
    // The part numbers its own rows from 1, as a --subjects capture does.
    raw: base.raw.filter((r) => subjects.includes(r.subject)).map((r, i) => ({ ...scale(r, 2), id: i + 1, run: 1 })),
  };
  const idRun = (r: Row) => [(r as { id?: unknown }).id, (r as { run?: unknown }).run];
  const strip = (r: Row) => ({ ...r, id: undefined, run: undefined });

  it("replaces only those subjects' rows and modules, and records the merge", () => {
    const merged = mergeSubjects(base as never, part as never, subjects) as unknown as Edition<Row[]>;
    expect(validateEdition(merged)).toEqual([]);
    expect(merged.raw.map((r) => r.subject)).toEqual(base.raw.map((r) => r.subject));
    const was = base.raw.filter((r) => r.subject === "zlib-rs-inflate");
    expect(merged.raw.filter((r) => r.subject === "zlib-rs-inflate")).toEqual(was);
    expect(merged.raw.filter((r) => r.subject === "zstd-decode").map(strip)).toEqual(part.raw.filter((r) => r.subject === "zstd-decode").map(strip));
    // Replaced rows keep the base's id and run, so ids stay unique.
    expect(merged.raw.map(idRun)).toEqual(base.raw.map(idRun));
    expect(new Set(merged.raw.map((r) => idRun(r)[0])).size).toBe(merged.raw.length);
    // zstd_read's modules come from the merge; lz4's (not merged) stay.
    expect(merged.artifacts.filter((a) => a.name.startsWith("variants/zstd_read/")).every((a) => a.sha256 === "a".repeat(64))).toBe(true);
    expect(merged.artifacts.filter((a) => a.name.startsWith("variants/lz4/"))).toEqual(base.artifacts.filter((a) => a.name.startsWith("variants/lz4/")));
    expect(merged.artifacts).toHaveLength(base.artifacts.length);
    expect(merged.capturedAt).toBe(base.capturedAt);
    expect(merged.merged).toEqual([{ subjects, capturedAt: part.capturedAt, endedAt: part.endedAt, browserVersion: "157.0.1", commit: part.commit }]);
  });

  it("checks drift on the merged subjects' series only", () => {
    // The merged subjects ran 2× slower: over all 22 rows that is diluted, on their own rows it is not.
    expect(driftFails(repeatDrift(rowsFor(part.raw, subjects), rowsFor(other.raw, subjects)))).toBe(true);
    expect(repeatDrift(rowsFor(part.raw, subjects), rowsFor(other.raw, subjects)).factor).toBeGreaterThan(1.8);
  });

  it("refuses a different sample count, and rejects a merged subject with no rows", () => {
    expect(() => mergeSubjects(base as never, { ...part, method: { ...part.method, samples: 5 } } as never, subjects)).toThrow(/samples differ/);
    expect(validateEdition({ ...base, merged: [{ subjects: ["nope"], capturedAt: part.capturedAt, endedAt: part.endedAt, browserVersion: "1", commit: part.commit }] })).toContain("every merged subject must have rows in raw");
  });
});
