import { describe, expect, it } from "vitest";

import { comparePerformance } from "./compare.mjs";
import { PERFORMANCE_BUDGETS, PERFORMANCE_SCHEMA_VERSION } from "./performance-contract.mjs";

function document(label, factor) {
  const metrics = {};
  for (const definition of PERFORMANCE_BUDGETS) {
    metrics[definition.id] ??= { unit: definition.unit };
    metrics[definition.id][definition.statistic] = definition.limit * factor;
  }
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    label,
    environment: { machine: "fixed-test-machine" },
    fixtures: { sizes: [0, 1_000, 100_000, 1_000_000] },
    metrics,
    fragments: []
  };
}

describe("performance comparison", () => {
  it("passes an unchanged result that stays below every budget", () => {
    expect(
      comparePerformance(document("v1-baseline", 0.5), document("v2-result", 0.5))
    ).toMatchObject({ pass: true, issues: [] });
  });

  it("fails an unexplained regression even when the result stays inside the absolute budget", () => {
    const comparison = comparePerformance(document("v1-baseline", 0.5), document("v2-result", 0.6));
    expect(comparison.pass).toBe(false);
    expect(comparison.results.some((result) => result.reason === "budget_or_regression")).toBe(
      true
    );
  });

  it("fails a missing release document field", () => {
    const invalid = document("v2-result", 0.5);
    delete invalid.environment;
    expect(comparePerformance(document("v1-baseline", 0.5), invalid)).toMatchObject({
      pass: false,
      issues: ["v2:environment"]
    });
  });
});
