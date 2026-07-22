import { expect, test } from "vitest";

import { quantile, summarizeSamples } from "./statistics.js";

test("summarizeSamples preserves raw order and calculates stable R-7 quantiles", () => {
  const summary = summarizeSamples([4, 1, 3, 2]);
  expect(summary.samples).toEqual([4, 1, 3, 2]);
  expect(summary.count).toBe(4);
  expect(summary.median).toBe(2.5);
  expect(summary.p95).toBe(3.8499999999999996);
  expect(summary.p99).toBe(3.9699999999999998);
});

test("quantile rejects empty, non-finite, and out-of-range input", () => {
  expect(() => quantile([], 0.5)).toThrow(/At least one/);
  expect(() => quantile([Number.NaN], 0.5)).toThrow(/finite/);
  expect(() => quantile([1], 1.1)).toThrow(/between zero and one/);
});
