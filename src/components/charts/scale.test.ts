import { describe, expect, it } from "vitest";
import { timeChange } from "@/lib/findings";
import { ratioPercent, ratioScale, ratioTick } from "./scale";

describe("ratio axis", () => {
  it("words a time ratio as findings.ts does, with one decimal always so columns align", () => {
    for (const r of [0.877, 1.123]) {
      expect(ratioPercent(r)).toBe(timeChange(r));
    }
    expect(ratioPercent(0.9)).toBe("10.0% less time");
    expect(ratioPercent(1.04)).toBe("4.0% more time");
    expect(ratioPercent(1)).toBe("no change");
  });
  it("ticks |r − 1| with a sign, at round percentages", () => {
    expect(ratioTick(0.9)).toBe("−10%");
    expect(ratioTick(1.1)).toBe("+10%");
    expect(ratioTick(1)).toBe("0%");
    const s = ratioScale(0.8, 1.2, 0, 400, { measure: () => 20 });
    expect(s.ticks).toContain(0.9);
    expect(s.ticks).toContain(1.1);
    expect(s.ticks.map(ratioTick).every((t) => /^(0|[+−]\d+(\.\d)?)%$/.test(t))).toBe(true);
  });
});
