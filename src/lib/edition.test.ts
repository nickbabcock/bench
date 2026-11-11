import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { formatEdition, repeatDrift, rowsFor, validateEdition } from "./edition";

const root = join(__dirname, "../data/editions");
const files: string[] = [];
(function walk(dir: string) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith(".json")) {
      files.push(p);
    }
  }
})(root);

describe("formatEdition", () => {
  it("writes every committed edition exactly as it is stored", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(formatEdition(JSON.parse(text)), f).toBe(text);
    }
  });

  it("parses back to the same value, with sample arrays on one line", () => {
    const edition = { id: "x", raw: { samples: [1.25, 2.5, 3.75], nested: { deep: Array.from({ length: 40 }, (_, i) => ({ i, name: `row ${i}` })) } } };
    const text = formatEdition(edition);
    expect(JSON.parse(text)).toEqual(edition);
    expect(text).toContain('"samples": [1.25,2.5,3.75]');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("writes an undefined entry of a broken-out array as null, like JSON.stringify", () => {
    const value = { rows: [{ name: "x".repeat(250) }, undefined] };
    const text = formatEdition(value);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)));
  });
});

describe("validateEdition", () => {
  const compression = () => JSON.parse(readFileSync(files.find((f) => f.split(sep).includes("compression"))!, "utf8"));

  it("accepts a committed capture", () => {
    expect(validateEdition(compression())).toEqual([]);
  });

  it("reports malformed compression configs instead of throwing", () => {
    const missing = compression();
    delete missing.raw.configs[0].encodeMs;
    expect(validateEdition(missing)).toEqual([expect.stringMatching(/encodeMs missing$/)]);
    const notObject = compression();
    notObject.raw.configs[0] = null;
    expect(validateEdition(notObject)).toEqual(["raw.configs[0] is not an object"]);
  });
});

describe("rowsFor", () => {
  const row = (subject: string, input: string, ms: number) => ({ subject, input: { name: input, bytes: 1 }, samples: { a: [ms, ms, ms, ms, ms] } });
  const base = [row("zstd-decode", "dickens", 10), row("zstd-decode", "xml", 20), row("alloc", "dickens", 30), row("other", "dickens", 99)];

  it("matches series by subject and input, whatever the subset run's order", () => {
    const part = [row("alloc", "dickens", 30), row("zstd-decode", "xml", 20), row("zstd-decode", "dickens", 10)];
    const subjects = ["alloc", "zstd-decode"];
    expect(repeatDrift(rowsFor(part, subjects), rowsFor(base, subjects))).toEqual({ factor: 1, outliers: 0 });
    expect(rowsFor(part, subjects)).toEqual(rowsFor(base, subjects));
  });
});
