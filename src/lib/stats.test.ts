import { describe, expect, it } from "vitest";
import { binomialCdfHalf, isSmall, medianCI, MIN_PAIRED_ROUNDS, pairedEffect, pairedRatios } from "./stats";

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const shuffle = (xs: number[]) => xs.map((x, i) => [x, (i * 7919) % 13] as const).sort((a, b) => a[1] - b[1]).map(([x]) => x);

describe("binomialCdfHalf", () => {
  it("matches exact values", () => {
    expect(binomialCdfHalf(3, 15)).toBeCloseTo(576 / 32768, 12);
    expect(binomialCdfHalf(4, 15)).toBeCloseTo(1941 / 32768, 12);
    expect(binomialCdfHalf(15, 15)).toBe(1);
    expect(binomialCdfHalf(-1, 15)).toBe(0);
  });
});

describe("medianCI", () => {
  it("is x(4)–x(12) at n = 15", () => {
    const ci = medianCI(shuffle(range(15)))!;
    expect([ci.lo, ci.hi, ci.k]).toEqual([4, 12, 4]);
    expect(ci.coverage).toBeCloseTo(1 - 2 * (576 / 32768), 10);
    expect(ci.coverage).toBeGreaterThanOrEqual(0.95);
  });

  it("is x(2)–x(9) at n = 10 and the min–max at n = 6", () => {
    expect(medianCI(range(10))).toMatchObject({ lo: 2, hi: 9, k: 2 });
    expect(medianCI(range(6))).toMatchObject({ lo: 1, hi: 6, k: 1 });
  });

  it("covers at least 95% for every n it answers", () => {
    for (let n = MIN_PAIRED_ROUNDS; n <= 200; n++) {
      const ci = medianCI(range(n))!;
      expect(ci.coverage).toBeGreaterThanOrEqual(0.95);
      // The next-narrower interval would fall short.
      expect(1 - 2 * binomialCdfHalf(ci.k, n)).toBeLessThan(0.95);
    }
  });

  it("has no interval below 6 rounds", () => {
    for (let n = 0; n < MIN_PAIRED_ROUNDS; n++) {
      expect(medianCI(range(n))).toBeUndefined();
    }
  });
});

describe("pairedEffect", () => {
  const around = (center: number, n = 15, jitter = 0.01) => range(n).map((i) => center * (1 + jitter * ((i % 5) - 2) / 2));

  it("claims faster when the median is >3% below 1 and the CI excludes 1", () => {
    const e = pairedEffect(around(0.9));
    expect(e.claim).toBe("faster");
    expect(e.ci!.hi).toBeLessThan(1);
    expect(e.n).toBe(15);
  });

  it("claims slower above 1", () => {
    expect(pairedEffect(around(1.1)).claim).toBe("slower");
  });

  it("says same when the median is within 3%, even with a tight CI", () => {
    const e = pairedEffect(around(1.02, 15, 0.001));
    expect(e.ci!.lo).toBeGreaterThan(1);
    expect(e.claim).toBe("same");
  });

  it("says same when the CI includes 1, even with a large median", () => {
    // Median 0.9, but a third of rounds above 1: x(4)..x(12) straddles 1.
    const xs = [0.5, 0.6, 0.7, 0.8, 0.85, 0.88, 0.89, 0.9, 0.91, 0.95, 1.05, 1.1, 1.2, 1.3, 1.4];
    const e = pairedEffect(xs);
    expect(e.median).toBe(0.9);
    expect(e.ci!.lo).toBeLessThan(1);
    expect(e.ci!.hi).toBeGreaterThan(1);
    expect(e.claim).toBe("same");
  });

  it("never uses the min–max: an outlier past 1 doesn't block a claim", () => {
    const xs = [...around(0.8, 14), 1.5];
    const e = pairedEffect(xs);
    expect(e.max).toBe(1.5);
    expect(e.claim).toBe("faster");
  });

  it("is insufficient below 6 rounds", () => {
    const e = pairedEffect([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(e.claim).toBe("insufficient");
    expect(e.ci).toBeUndefined();
    expect(pairedEffect([]).claim).toBe("insufficient");
  });

  it("pairs by round", () => {
    expect(pairedRatios([2, 4, 6], [1, 2, 3, 4])).toEqual([2, 2, 2]);
  });
});

describe("isSmall", () => {
  it("marks effects under 5% as small", () => {
    expect(isSmall(0.96)).toBe(true);
    expect(isSmall(1.049)).toBe(true);
    expect(isSmall(0.95)).toBe(false);
    expect(isSmall(pairedEffect(Array(15).fill(1.2)))).toBe(false);
    expect(isSmall(NaN)).toBe(false);
  });
});
