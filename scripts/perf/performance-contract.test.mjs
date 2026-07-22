import { describe, expect, it } from "vitest";

import {
  evaluateBudget,
  PERFORMANCE_BUDGETS,
  PERFORMANCE_SCHEMA_VERSION,
  validatePerformanceDocument
} from "./performance-contract.mjs";

const healthBudget = PERFORMANCE_BUDGETS[0];

function document(value) {
  return { metrics: { [healthBudget.id]: { [healthBudget.statistic]: value } } };
}

describe("V2 performance contract", () => {
  it("allows at most five percent regression when V1 already meets the budget", () => {
    expect(evaluateBudget(healthBudget, document(1_000), document(1_049))).toMatchObject({
      pass: true,
      relativeLimit: 1_050
    });
    expect(evaluateBudget(healthBudget, document(1_000), document(1_051))).toMatchObject({
      pass: false,
      relativePass: false
    });
  });

  it("requires a twenty percent reduction and the absolute budget after a V1 miss", () => {
    expect(evaluateBudget(healthBudget, document(2_000), document(1_500))).toMatchObject({
      pass: true,
      relativeLimit: 1_600
    });
    expect(evaluateBudget(healthBudget, document(2_000), document(1_550))).toMatchObject({
      pass: false,
      absolutePass: false
    });
  });

  it("rejects a missing metric and an incomplete result document", () => {
    expect(evaluateBudget(healthBudget, document(1_000), { metrics: {} })).toMatchObject({
      pass: false,
      reason: "missing_metric"
    });
    expect(
      validatePerformanceDocument(
        {
          schemaVersion: PERFORMANCE_SCHEMA_VERSION,
          label: "v1-baseline",
          environment: {},
          fixtures: {},
          metrics: {},
          fragments: []
        },
        "v1-baseline"
      )
    ).toEqual([]);
  });
});
