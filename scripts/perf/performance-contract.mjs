export const PERFORMANCE_SCHEMA_VERSION = 1;

export const PERFORMANCE_BUDGETS = Object.freeze([
  budget("startup.health_ready_ms", "p95", 1_500, "ms"),
  budget("startup.app_work_ms", "p95", 2_000, "ms"),
  budget("client.cold_fcp_ms", "median", 1_000, "ms"),
  budget("client.cold_lcp_ms", "median", 1_500, "ms"),
  budget("client.warm_lcp_ms", "median", 800, "ms"),
  budget("client.total_blocking_time_ms", "median", 100, "ms"),
  budget("client.cumulative_layout_shift", "value", 0.02, "score"),
  budget("client.warm_route_ms", "p95", 200, "ms"),
  budget("bundle.practice_js_gzip_kib", "value", 220, "KiB"),
  budget("bundle.practice_css_gzip_kib", "value", 50, "KiB"),
  budget("bundle.practice_transfer_kib", "value", 400, "KiB"),
  budget("bundle.max_lazy_chunk_gzip_kib", "value", 250, "KiB"),
  budget("typing.handler_ms", "p95", 4, "ms"),
  budget("typing.handler_ms", "p99", 8, "ms"),
  budget("typing.chromium_input_to_paint_ms", "p95", 20, "ms"),
  budget("typing.webkit_input_to_paint_ms", "p95", 30, "ms"),
  budget("typing.input_to_paint_ms", "p99", 50, "ms"),
  budget("typing.long_task_ms", "value", 50, "ms"),
  budget("sound.key_to_schedule_ms", "p95", 45, "ms"),
  budget("server.common_read_ms", "p95", 75, "ms"),
  budget("server.common_save_ms", "p95", 100, "ms"),
  budget("database.hot_query_ms", "p95", 50, "ms"),
  budget("server.next_block_ms", "p95", 50, "ms"),
  budget("server.event_loop_delay_ms", "p99", 20, "ms"),
  budget("memory.retained_heap_growth_percent", "value", 15, "percent"),
  budget("memory.retained_heap_growth_mib", "value", 20, "MiB")
]);

function budget(id, statistic, limit, unit) {
  return Object.freeze({ id, statistic, limit, unit, direction: "lower" });
}

export function metricKey(budgetDefinition) {
  return `${budgetDefinition.id}.${budgetDefinition.statistic}`;
}

export function readMetric(document, budgetDefinition) {
  const metric = document?.metrics?.[budgetDefinition.id];
  const value = metric?.[budgetDefinition.statistic];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function evaluateBudget(budgetDefinition, v1Document, v2Document) {
  const v1 = readMetric(v1Document, budgetDefinition);
  const v2 = readMetric(v2Document, budgetDefinition);
  const base = {
    id: budgetDefinition.id,
    statistic: budgetDefinition.statistic,
    unit: budgetDefinition.unit,
    budget: budgetDefinition.limit,
    v1,
    v2
  };

  if (v1 === null || v2 === null) {
    return { ...base, pass: false, reason: "missing_metric" };
  }

  const absoluteChange = v2 - v1;
  const percentageChange = v1 === 0 ? null : (absoluteChange / v1) * 100;
  const absolutePass = v2 <= budgetDefinition.limit;
  const relativeLimit = v1 <= budgetDefinition.limit ? v1 * 1.05 : v1 * 0.8;
  const relativePass = v2 <= relativeLimit;

  return {
    ...base,
    absoluteChange,
    percentageChange,
    absolutePass,
    relativeLimit,
    relativePass,
    pass: absolutePass && relativePass,
    reason: absolutePass && relativePass ? "pass" : "budget_or_regression"
  };
}

export function validatePerformanceDocument(document, expectedLabel) {
  const issues = [];
  if (document?.schemaVersion !== PERFORMANCE_SCHEMA_VERSION) issues.push("schemaVersion");
  if (document?.label !== expectedLabel) issues.push("label");
  if (!document?.environment || typeof document.environment !== "object")
    issues.push("environment");
  if (!document?.fixtures || typeof document.fixtures !== "object") issues.push("fixtures");
  if (!document?.metrics || typeof document.metrics !== "object") issues.push("metrics");
  if (!Array.isArray(document?.fragments)) issues.push("fragments");
  return issues;
}
