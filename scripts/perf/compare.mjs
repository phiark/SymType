import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/* global console, process */
import { dirname, resolve } from "node:path";

import {
  evaluateBudget,
  PERFORMANCE_BUDGETS,
  validatePerformanceDocument
} from "./performance-contract.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

export function comparePerformance(v1Document, v2Document) {
  const issues = [
    ...validatePerformanceDocument(v1Document, "v1-baseline").map((issue) => `v1:${issue}`),
    ...validatePerformanceDocument(v2Document, "v2-result").map((issue) => `v2:${issue}`)
  ];
  if (issues.length > 0) return { pass: false, issues, results: [] };

  const results = PERFORMANCE_BUDGETS.map((definition) =>
    evaluateBudget(definition, v1Document, v2Document)
  );
  return {
    pass: results.every((result) => result.pass),
    issues: [],
    results
  };
}

function printResult(comparison) {
  if (comparison.issues.length > 0) {
    console.error(`Performance document errors: ${comparison.issues.join(", ")}`);
    return;
  }
  console.table(
    comparison.results.map((result) => ({
      metric: `${result.id}.${result.statistic}`,
      v1: result.v1,
      v2: result.v2,
      budget: result.budget,
      changePercent:
        result.percentageChange === null ? "n/a" : Number(result.percentageChange.toFixed(2)),
      pass: result.pass
    }))
  );
}

function parseArguments(argumentsList) {
  const options = {
    v1: resolve("reports/performance/v1-baseline.json"),
    v2: resolve("reports/performance/v2-result.json"),
    output: resolve("reports/performance/comparison.json")
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const value = argumentsList[index];
    if (value === "--v1") options.v1 = resolve(argumentsList[++index]);
    else if (value === "--v2") options.v2 = resolve(argumentsList[++index]);
    else if (value === "--output") options.output = resolve(argumentsList[++index]);
    else throw new Error(`Unknown performance comparison argument: ${value}`);
  }
  return options;
}

export function runComparison(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList);
  const comparison = comparePerformance(readJson(options.v1), readJson(options.v2));
  writeJsonAtomic(options.output, comparison);
  printResult(comparison);
  if (!comparison.pass) process.exitCode = 1;
  return comparison;
}

if (resolve(process.argv[1] ?? "") === resolve(import.meta.filename)) runComparison();
