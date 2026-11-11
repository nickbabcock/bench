import { describe, expect, it } from "vitest";
import {
  ask,
  askReproduced,
  type Cell,
  effectsDiffer,
  effectsDifference,
  engineScope,
  type FigureQuestion,
  gate,
  inputScope,
  mainPoints,
  nb,
  pct,
  relativeSentence,
  relativeTo,
  reproducedIn,
  scopeOf,
  sizeChange,
  speedChange,
  timeChange,
  withheldNote,
} from "./findings";
import { pairedEffect } from "./stats";

const m4 = { id: "m4pro-arm64", cpuModel: "Apple M4 Pro", arch: "arm64" };
const cell = (engine: string, input: string | null, machine = m4): Cell => ({ engine, machine, input });

describe("numbers", () => {
  it("formats percent with at most one decimal", () => {
    expect(pct(0.1234)).toBe("12.3%");
    expect(pct(0.04)).toBe("4%");
    expect(pct(-0.004)).toBe("0.4%");
  });
  it("formats aligned columns with one decimal", () => {
    expect(pct(0.04, true)).toBe("4.0%");
  });
  it("words time ratios as speed", () => {
    expect(speedChange(0.8)).toBe("25% faster");
    expect(speedChange(1.25)).toBe("20% slower");
    expect(speedChange(0.25)).toBe("4× faster");
    expect(timeChange(0.9)).toBe("10% less time");
    expect(sizeChange(1.042)).toBe("4.2% larger");
  });
});

describe("scope", () => {
  const inputs = ["dickens", "xml", "x-ray", "samba"];
  it("scopes inputs", () => {
    expect(inputScope(["dickens"], inputs)).toBe("on dickens");
    expect(inputScope(["dickens", "xml", "samba"], inputs)).toBe("on 3 of 4 inputs");
    expect(inputScope(inputs, inputs)).toBe("on all 4 inputs");
    expect(inputScope(["dickens", "x-ray"], ["dickens", "x-ray"])).toBe("on both inputs");
    expect(inputScope(["dickens"], ["dickens"])).toBe("");
  });
  it("scopes engines", () => {
    expect(engineScope(["Firefox"], ["Chrome", "Firefox"])).toBe("in Firefox");
    expect(engineScope(["Chrome", "Firefox"], ["Chrome", "Firefox"])).toBe("in Chrome and Firefox");
  });
  it("combines a full grid and lists a ragged one", () => {
    const all = ["Chrome", "Firefox"].flatMap((e) => ["dickens", "x-ray"].map((i) => cell(e, i)));
    expect(scopeOf(all, all)).toBe("on both inputs, in Chrome and Firefox");
    expect(scopeOf(all.filter((c) => c.engine === "Chrome"), all)).toBe("on both inputs, in Chrome");
    expect(scopeOf([all[0], all[3]], all)).toBe("on dickens, in Chrome; on x-ray, in Firefox");
    const three = ["Chrome", "Firefox", "Safari"].flatMap((e) => ["dickens", "x-ray"].map((i) => cell(e, i)));
    expect(scopeOf(three.slice(0, 5), three)).toBe("on both inputs, in Chrome and Firefox; on dickens, in Safari");
  });
});

describe("per-cell reproduction gate", () => {
  type C = Cell & { higher: boolean };
  const capture = (higherIn: string[]): C[] => ["Chrome", "Firefox"].map((e) => ({ ...cell(e, null), higher: higherIn.includes(e) }));
  // A claim built the way generators build theirs: held cells, then scope.
  const memory: FigureQuestion<C[]> = {
    figure: 1,
    question: "Is wasm64's peak memory higher?",
    neutral: "Peak memory",
    answer: (cells, replicates) => {
      const higher = reproducedIn(replicates, (c: C) => (c.higher ? "higher" : undefined));
      const held = cells.filter((c) => higher(c) === "higher");
      if (held.length === 0) {
        return {};
      }
      const scope = scopeOf(held, cells);
      return { title: `Higher ${scope}`, claim: { key: "memory:higher", text: `Higher ${scope}.`, scope, cells: held } };
    },
  };
  // The same question with no narrowing, so only gate() stands between it and a headline.
  const unnarrowed: FigureQuestion<C[]> = { ...memory, answer: (cells) => memory.answer(cells) };

  it("does not reproduce Chrome-only in capture 1 and Firefox-only in capture 2", () => {
    const a = capture(["Chrome"]);
    const b = capture(["Firefox"]);
    expect(ask(unnarrowed, a).claim?.key).toBe(ask(unnarrowed, b).claim?.key);
    expect(gate(ask(unnarrowed, a), [ask(unnarrowed, b)]).claim).toBeUndefined();
    expect(askReproduced(unnarrowed, a, [b]).claim).toBeUndefined();
    expect(askReproduced(memory, a, [b]).claim).toBeUndefined();
  });
  it("reproduces when the same cells hold in both captures", () => {
    const f = askReproduced(memory, capture(["Chrome"]), [capture(["Chrome", "Firefox"])]);
    expect(f.claim?.scope).toBe("in Chrome");
  });
  it("narrows to the reproduced cells instead of dropping the claim", () => {
    const both = capture(["Chrome", "Firefox"]);
    expect(askReproduced(unnarrowed, both, [capture(["Chrome"])]).claim).toBeUndefined();
    expect(askReproduced(memory, both, [capture(["Chrome"])]).claim?.scope).toBe("in Chrome");
  });
  it("leaves a this-machine answer (no replicates) unchanged", () => {
    expect(ask(memory, capture(["Chrome", "Firefox"])).claim?.scope).toBe("in Chrome and Firefox");
  });
});

describe("questions and the reproduction gate", () => {
  const q: FigureQuestion<number> = {
    figure: 2,
    question: "Is it big?",
    neutral: "Size",
    answer: (x) => (x > 1 ? { title: "It was big", claim: { key: "big", text: "It was big (Figure 2).", scope: "" } } : {}),
  };
  it("falls back to the neutral title", () => {
    expect(ask(q, 0).title).toBe("Size");
    expect(ask(q, 2)).toMatchObject({ title: "It was big", claim: { figure: 2, key: "big" } });
  });
  it("keeps a claim only when it reproduces", () => {
    expect(gate(ask(q, 2), [ask(q, 3)]).claim?.key).toBe("big");
    const failed = gate(ask(q, 2), [ask(q, 0)]);
    expect(failed.claim).toBeUndefined();
    expect(failed.title).toBe("Size");
    expect(failed.tableOnly[0].key).toBe("big");
    expect(gate(ask(q, 2), []).claim).toBeUndefined();
  });
  it("lists main points in figure order", () => {
    expect(mainPoints([ask(q, 2), ask(q, 0)])).toEqual(["It was big (Figure 2)."]);
  });
});

describe("large differences and this machine", () => {
  it("flags a claim flip or a gap over 3% between engines", () => {
    const fast = pairedEffect(Array(15).fill(0.9));
    const same = pairedEffect(Array(15).fill(0.99));
    const fast2 = pairedEffect(Array(15).fill(0.92));
    expect(effectsDiffer(fast, same)).toBe(true);
    expect(effectsDiffer(fast, fast2)).toBe(false);
    expect(effectsDiffer(pairedEffect(Array(15).fill(0.8)), fast)).toBe(true);
  });
  it("counts a claim-status flip only with medians at least half the threshold apart", () => {
    // 3.2% claimed beside 2.9% not claimed: a flip, but 0.3 points apart.
    const justClaimed = pairedEffect(Array(15).fill(0.968));
    const justNot = pairedEffect(Array(15).fill(0.971));
    expect(justClaimed.claim).toBe("faster");
    expect(justNot.claim).toBe("same");
    expect(effectsDifference(justClaimed, justNot)).toBeUndefined();
    // 4% claimed beside 1% not: 3 points apart, at least 1.5.
    expect(effectsDifference(pairedEffect(Array(15).fill(0.96)), pairedEffect(Array(15).fill(0.99)))).toBe("status");
  });
  it("always counts a direction flip", () => {
    const faster = pairedEffect(Array(15).fill(0.965));
    const slower = pairedEffect(Array(15).fill(1.035));
    expect(effectsDifference(faster, slower)).toBe("direction");
  });
  it("compares this machine with the reference", () => {
    const ids = "abcdefghij".split("");
    const ref = Object.fromEntries(ids.map((id) => [id, 100]));
    const cur = Object.fromEntries(ids.map((id) => [id, id === "j" ? 60 : 50]));
    const r = relativeTo(ref, cur)!;
    expect(r.k).toBe(10);
    expect(r.moved).toEqual(["j"]);
    expect(relativeSentence(r)).toBe("This machine ran 49.1% slower than the reference overall (geometric mean over 10 configurations; from 50% slower to 40% slower).");
    const faster = relativeTo({ a: 100, b: 100 }, { a: 105, b: 105 })!;
    expect(relativeSentence(faster, "This machine", "the Chrome 156 reference")).toBe(
      "This machine ran 5% faster than the Chrome 156 reference overall (geometric mean over 2 configurations; each 5% faster).",
    );
    expect(relativeSentence(faster)).not.toMatch(/\d×/);
    const one = relativeTo({ a: 100 }, { a: 80 })!;
    expect(relativeSentence(one, "This machine", "the reference", "row")).toBe("This machine ran 20% slower than the reference overall (geometric mean over 1 row).");
    expect(relativeSentence(faster, "This machine", "the reference", "row")).toMatch(/over 2 rows;/);
  });
});

describe("withheld settings", () => {
  it("words what the drift gate withheld", () => {
    expect(withheldNote([])).toBe("");
    expect(withheldNote([{ browser: "safari", name: "Safari", input: "samba", factor: 5.4, outliers: 0.9 }])).toBe(
      "Safari's two captures of samba disagreed (one ran 5.4× slower), so Safari is not shown for samba.",
    );
    expect(withheldNote([{ browser: "safari", factor: 1 / 1.4, outliers: 0.5 }])).toBe("Safari's two captures disagreed (one ran 1.4× slower), so Safari is not shown.");
    expect(withheldNote([{ browser: "firefox", factor: 1.1, outliers: 0.08 }])).toBe(
      "Firefox's two captures disagreed (8% of series moved by more than 1.5×), so Firefox is not shown.",
    );
  });
});

describe("keepTogether", () => {
  it("wraps hyphenated tokens in nowrap spans and keeps ASCII hyphens", async () => {
    const { keepTogether } = await import("@/components/release/nb");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement, Fragment } = await import("react");
    const html = renderToStaticMarkup(createElement(Fragment, null, keepTogether("wasm-opt -O3 cut zlib-rs time (-Os).")));
    expect(html).toBe('<span class="whitespace-nowrap">wasm-opt</span> <span class="whitespace-nowrap">-O3</span> cut <span class="whitespace-nowrap">zlib-rs</span> time <span class="whitespace-nowrap">(-Os).</span>');
    expect(html).not.toContain("\u2011");
    expect(keepTogether("about the same")).toBe("about the same");
  });
});

describe("typography", () => {
  it("keeps names with hyphens on one line", () => {
    expect(nb("wasm-opt -O3 on zlib-rs and bump-scope")).toBe("wasm\u2011opt \u2011O3 on zlib\u2011rs and bump\u2011scope");
    expect(nb("lz4_flex — 3–5% − 1")).toBe("lz4_flex — 3–5% − 1");
    expect(nb("2 - 1")).toBe("2 - 1");
  });
});
