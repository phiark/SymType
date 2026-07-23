export const MACOS_PERFORMANCE_SCHEMA_VERSION = 1;
export const MACOS_REQUIRED_SAMPLE_COUNT = 20;

export const MACOS_ABSOLUTE_BUDGETS = Object.freeze([
  sampleBudget("startup.empty_app_to_interactive_ms", "p95", 2_000, "ms"),
  sampleBudget("startup.100k_same_day_ms", "p95", 2_000, "ms"),
  sampleBudget("startup.100k_first_daily_backup_ms", "p95", 5_000, "ms"),
  sampleBudget("lifecycle.warm_reopen_ms", "p95", 300, "ms"),
  sampleBudget("typing.webkit_input_to_paint_ms", "p95", 30, "ms"),
  sampleBudget("typing.webkit_input_to_paint_ms", "p99", 50, "ms"),
  sampleBudget("persistence.event_batch_24_ms", "p95", 50, "ms"),
  sampleBudget("persistence.event_batch_24_ms", "p99", 100, "ms"),
  sampleBudget("persistence.flush_and_next_block_ms", "p95", 200, "ms"),
  valueBudget("memory.renderer_heap_growth_percent", 15, "percent", {
    minimumDurationMinutes: 30
  }),
  valueBudget("memory.renderer_heap_growth_mib", 20, "MiB", {
    minimumDurationMinutes: 30
  }),
  valueBudget("memory.server_rss_growth_mib", 20, "MiB", {
    minimumDurationMinutes: 30
  }),
  sampleBudget("cpu.idle_percent", "median", 1, "percent"),
  sampleBudget("cpu.idle_percent", "p95", 3, "percent"),
  valueBudget("size.app_bytes", 200 * 1024 * 1024, "bytes"),
  valueBudget("size.dmg_bytes", 120 * 1024 * 1024, "bytes")
]);

export const MACOS_RELATIVE_BUDGETS = Object.freeze([
  {
    id: "analytics.100k_all_time_ms",
    statistic: "p95",
    maximumRegressionPercent: 5,
    minimumSamples: MACOS_REQUIRED_SAMPLE_COUNT,
    unit: "ms"
  }
]);

function sampleBudget(id, statistic, limit, unit) {
  return Object.freeze({
    id,
    statistic,
    limit,
    unit,
    minimumSamples: MACOS_REQUIRED_SAMPLE_COUNT
  });
}

function valueBudget(id, limit, unit, extra = {}) {
  return Object.freeze({ id, statistic: "value", limit, unit, ...extra });
}

export function percentile(sortedSamples, fraction) {
  if (sortedSamples.length === 0) return null;
  const rank = Math.max(1, Math.ceil(sortedSamples.length * fraction));
  return sortedSamples[Math.min(rank - 1, sortedSamples.length - 1)];
}

export function summarizeSamples(samples) {
  if (
    !Array.isArray(samples) ||
    samples.length === 0 ||
    samples.some((sample) => typeof sample !== "number" || !Number.isFinite(sample) || sample < 0)
  ) {
    return null;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return {
    samples: sorted.length,
    median,
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    min: sorted[0],
    max: sorted.at(-1)
  };
}

export function validateMacOSPerformanceDocument(document, expectedKind) {
  const issues = [];
  if (document?.schemaVersion !== MACOS_PERFORMANCE_SCHEMA_VERSION) issues.push("schemaVersion");
  if (document?.kind !== expectedKind) issues.push("kind");
  if (!/^[0-9a-f]{40}$/.test(document?.commitSha ?? "")) issues.push("commitSha");
  if (document?.nodeVersion !== "24.18.0") issues.push("nodeVersion");
  if (document?.nodeAbi !== "137") issues.push("nodeAbi");
  if (document?.architecture !== "arm64") issues.push("architecture");
  if (document?.minimumMacOS !== "15.0") issues.push("minimumMacOS");
  if (
    typeof document?.measuredAt !== "string" ||
    document.measuredAt.length > 40 ||
    !isCanonicalIsoTimestamp(document.measuredAt)
  ) {
    issues.push("measuredAt");
  }
  const environment = document?.environment;
  if (!boundedString(environment?.machineModel, 120)) issues.push("environment.machineModel");
  if (
    !Number.isSafeInteger(environment?.physicalMemoryBytes) ||
    environment.physicalMemoryBytes <= 0
  ) {
    issues.push("environment.physicalMemoryBytes");
  }
  if (!boundedString(environment?.macOSBuild, 80)) issues.push("environment.macOSBuild");
  if (!["ac", "battery"].includes(environment?.powerSource)) {
    issues.push("environment.powerSource");
  }
  if (!["nominal", "fair", "serious", "critical"].includes(environment?.thermalState)) {
    issues.push("environment.thermalState");
  }
  const fixture = document?.fixture;
  if (!boundedString(fixture?.id, 128) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fixture.id)) {
    issues.push("fixture.id");
  }
  if (!/^[0-9a-f]{64}$/.test(fixture?.sha256 ?? "")) issues.push("fixture.sha256");
  if (fixture?.schemaVersion !== 10) issues.push("fixture.schemaVersion");
  if (fixture?.integrityOk !== true) issues.push("fixture.integrityOk");
  if (fixture?.foreignKeysOk !== true) issues.push("fixture.foreignKeysOk");
  if (
    !Array.isArray(fixture?.dailyBackupCases) ||
    fixture.dailyBackupCases.length !== 2 ||
    !fixture.dailyBackupCases.includes("present") ||
    !fixture.dailyBackupCases.includes("absent-reset-each-sample")
  ) {
    issues.push("fixture.dailyBackupCases");
  }
  if (expectedKind === "packaged-app") {
    if (document?.run?.installedPath !== "/Applications/SymType.app") {
      issues.push("run.installedPath");
    }
    if (document?.run?.offline !== true) issues.push("run.offline");
    if (document?.run?.systemNodeAvailable !== false) {
      issues.push("run.systemNodeAvailable");
    }
  } else if (document?.run?.mode !== "production-source") {
    issues.push("run.mode");
  }
  if (!document?.metrics || typeof document.metrics !== "object") issues.push("metrics");
  return issues;
}

function boundedString(value, maximumLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function isCanonicalIsoTimestamp(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function readBudgetValue(document, budget) {
  const metric = document?.metrics?.[budget.id];
  if (!metric) return { value: null, samples: null, durationMinutes: null };
  if (budget.statistic === "value") {
    return {
      value:
        typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : null,
      samples: null,
      durationMinutes: metric.durationMinutes ?? null
    };
  }
  const summary = summarizeSamples(metric.samples);
  return {
    value: summary?.[budget.statistic] ?? null,
    samples: summary?.samples ?? null,
    durationMinutes: metric.durationMinutes ?? null
  };
}

export function evaluateMacOSPerformance(baseline, packaged) {
  const issues = [
    ...validateMacOSPerformanceDocument(baseline, "source-baseline").map(
      (field) => `baseline.${field}`
    ),
    ...validateMacOSPerformanceDocument(packaged, "packaged-app").map(
      (field) => `packaged.${field}`
    )
  ];
  if (baseline?.commitSha !== packaged?.commitSha) issues.push("commitSha_mismatch");
  for (const field of ["machineModel", "physicalMemoryBytes", "macOSBuild"]) {
    if (baseline?.environment?.[field] !== packaged?.environment?.[field]) {
      issues.push(`environment_mismatch.${field}`);
    }
  }
  for (const field of ["id", "sha256", "schemaVersion"]) {
    if (baseline?.fixture?.[field] !== packaged?.fixture?.[field]) {
      issues.push(`fixture_mismatch.${field}`);
    }
  }

  const absolute = MACOS_ABSOLUTE_BUDGETS.map((budget) => {
    const observed = readBudgetValue(packaged, budget);
    const samplePass =
      budget.minimumSamples === undefined || observed.samples >= budget.minimumSamples;
    const durationPass =
      budget.minimumDurationMinutes === undefined ||
      observed.durationMinutes >= budget.minimumDurationMinutes;
    const pass =
      observed.value !== null && observed.value <= budget.limit && samplePass && durationPass;
    return {
      id: budget.id,
      statistic: budget.statistic,
      unit: budget.unit,
      limit: budget.limit,
      observed: observed.value,
      sampleCount: observed.samples,
      minimumSamples: budget.minimumSamples ?? null,
      durationMinutes: observed.durationMinutes,
      minimumDurationMinutes: budget.minimumDurationMinutes ?? null,
      pass
    };
  });

  const relative = MACOS_RELATIVE_BUDGETS.map((budget) => {
    const source = readBudgetValue(baseline, budget);
    const installed = readBudgetValue(packaged, budget);
    const limit =
      source.value === null ? null : source.value * (1 + budget.maximumRegressionPercent / 100);
    const pass =
      source.value !== null &&
      installed.value !== null &&
      source.samples >= budget.minimumSamples &&
      installed.samples >= budget.minimumSamples &&
      installed.value <= limit;
    return {
      id: budget.id,
      statistic: budget.statistic,
      unit: budget.unit,
      baseline: source.value,
      packaged: installed.value,
      maximumRegressionPercent: budget.maximumRegressionPercent,
      limit,
      baselineSampleCount: source.samples,
      packagedSampleCount: installed.samples,
      pass
    };
  });

  return {
    schemaVersion: 1,
    commitSha: packaged?.commitSha ?? null,
    issues,
    absolute,
    relative,
    pass:
      issues.length === 0 &&
      absolute.every((result) => result.pass) &&
      relative.every((result) => result.pass)
  };
}
