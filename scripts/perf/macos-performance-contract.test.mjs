import { describe, expect, it } from "vitest";

import {
  evaluateMacOSPerformance,
  MACOS_ABSOLUTE_BUDGETS,
  MACOS_RELATIVE_BUDGETS,
  summarizeSamples
} from "./macos-performance-contract.mjs";

function samples(value, count = 20) {
  return Array.from({ length: count }, () => value);
}

function document(kind, commitSha = "a".repeat(40)) {
  const metrics = {};
  for (const budget of MACOS_ABSOLUTE_BUDGETS) {
    if (budget.statistic === "value") {
      metrics[budget.id] = {
        value: budget.limit,
        ...(budget.minimumDurationMinutes ? { durationMinutes: budget.minimumDurationMinutes } : {})
      };
    } else {
      metrics[budget.id] ??= { samples: samples(budget.limit) };
    }
  }
  for (const budget of MACOS_RELATIVE_BUDGETS) {
    metrics[budget.id] = { samples: samples(100) };
  }
  return {
    schemaVersion: 1,
    kind,
    commitSha,
    nodeVersion: "24.18.0",
    nodeAbi: "137",
    architecture: "arm64",
    minimumMacOS: "15.0",
    measuredAt: "2026-07-23T00:00:00.000Z",
    environment: {
      machineModel: "MacBookPro18,3",
      physicalMemoryBytes: 34_359_738_368,
      macOSBuild: "24G90",
      powerSource: "ac",
      thermalState: "nominal"
    },
    fixture: {
      id: "symtype-100k-v1",
      sha256: "b".repeat(64),
      schemaVersion: 10,
      integrityOk: true,
      foreignKeysOk: true,
      dailyBackupCases: ["present", "absent-reset-each-sample"]
    },
    run:
      kind === "packaged-app"
        ? {
            installedPath: "/Applications/SymType.app",
            offline: true,
            systemNodeAvailable: false
          }
        : { mode: "production-source" },
    metrics
  };
}

describe("macOS performance contract", () => {
  it("uses nearest-rank p95 and p99 with a conventional median", () => {
    expect(summarizeSamples(Array.from({ length: 20 }, (_, index) => index + 1))).toMatchObject({
      samples: 20,
      median: 10.5,
      p95: 19,
      p99: 20
    });
  });

  it("accepts complete same-commit evidence at every limit", () => {
    const result = evaluateMacOSPerformance(document("source-baseline"), document("packaged-app"));
    expect(result.issues).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("rejects too few samples, short memory runs, and analytics regression over five percent", () => {
    const baseline = document("source-baseline");
    const packaged = document("packaged-app");
    packaged.metrics["startup.empty_app_to_interactive_ms"].samples = samples(1_000, 19);
    packaged.metrics["memory.server_rss_growth_mib"].durationMinutes = 29;
    packaged.metrics["analytics.100k_all_time_ms"].samples = samples(105.01);

    const result = evaluateMacOSPerformance(baseline, packaged);
    expect(result.pass).toBe(false);
    expect(
      result.absolute.find((entry) => entry.id === "startup.empty_app_to_interactive_ms")
    ).toMatchObject({ pass: false, sampleCount: 19 });
    expect(
      result.absolute.find((entry) => entry.id === "memory.server_rss_growth_mib")
    ).toMatchObject({ pass: false, durationMinutes: 29 });
    expect(result.relative[0]).toMatchObject({ pass: false, limit: 105 });
  });

  it("rejects incomplete provenance and a packaged run outside the acceptance environment", () => {
    const baseline = document("source-baseline");
    const packaged = document("packaged-app");
    packaged.measuredAt = "July 23";
    packaged.environment.machineModel = "";
    packaged.fixture.sha256 = "not-a-hash";
    packaged.run.installedPath = "/tmp/SymType.app";
    packaged.run.offline = false;
    packaged.run.systemNodeAvailable = true;

    const result = evaluateMacOSPerformance(baseline, packaged);
    expect(result.pass).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "packaged.environment.machineModel",
        "packaged.measuredAt",
        "packaged.fixture.sha256",
        "packaged.run.installedPath",
        "packaged.run.offline",
        "packaged.run.systemNodeAvailable",
        "environment_mismatch.machineModel"
      ])
    );
  });
});
