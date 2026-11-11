import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { keepTogether } from "./nb";

const html = (t: string) => renderToStaticMarkup(createElement(Fragment, null, keepTogether(t)));
const kept = (t: string) => [...html(t).matchAll(/<span class="whitespace-nowrap">([^<]*)<\/span>/g)].map((m) => m[1]);

describe("keepTogether", () => {
  it("holds ranges with their units, and numbers with theirs, on one line", () => {
    expect(kept("switching at ≈10–100 and ≈150–500 Mbps, from ≈100 to 300 Mbps")).toEqual(["≈10–100", "≈150–500 Mbps", "≈100 to 300 Mbps"]);
    expect(kept("256 KiB more heap, 1.83 kB smaller; ran 1.6–2.2× as fast; 3.8% less")).toEqual(["256 KiB", "1.83 kB", "1.6–2.2×"]);
  });

  it("still holds hyphenated names, and leaves plain counts alone", () => {
    expect(kept("zstd 9, 3 then 1 with wasm-opt -Os in 11 of 12 pairs")).toEqual(["wasm-opt", "-Os"]);
  });
});
