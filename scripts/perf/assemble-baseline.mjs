#!/usr/bin/env node

/* global process */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { writeJsonAtomic } from "./lib/json-files.js";
import { PERFORMANCE_SCHEMA_VERSION } from "./performance-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const defaultInputs = [
  "startup.json",
  "bundle.json",
  "database.json",
  "server.json",
  "p3-client.json"
];

function readFragment(path) {
  const text = readFileSync(path, "utf8");
  const document = JSON.parse(text);
  if (document.schemaVersion !== PERFORMANCE_SCHEMA_VERSION || !document.fragment) {
    throw new Error(`Invalid performance fragment: ${path}`);
  }
  if (!document.environment || !document.metrics) {
    throw new Error(`Incomplete performance fragment: ${path}`);
  }
  return {
    document,
    evidence: {
      file: path.slice(root.length + 1),
      fragment: document.fragment,
      sha256: createHash("sha256").update(text).digest("hex")
    }
  };
}

function mergeMetrics(fragments) {
  const metrics = {};
  for (const { document } of fragments) {
    for (const [id, value] of Object.entries(document.metrics)) {
      if (Object.hasOwn(metrics, id)) throw new Error(`Duplicate performance metric: ${id}`);
      metrics[id] = value;
    }
  }
  return metrics;
}

function parseArguments(arguments_) {
  const options = {
    output: resolve(root, "reports/performance/v1-baseline.json"),
    inputs: defaultInputs.map((name) => resolve(root, "reports/performance/fragments", name))
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--output") options.output = resolve(arguments_[++index] ?? "");
    else if (argument === "--inputs") {
      options.inputs = (arguments_[++index] ?? "").split(",").map((path) => resolve(path));
    } else throw new Error(`Unknown baseline assembly argument: ${argument}`);
  }
  return options;
}

export function assembleBaseline(options = parseArguments([])) {
  const fragments = options.inputs.map(readFragment);
  const byName = Object.fromEntries(fragments.map(({ document }) => [document.fragment, document]));
  for (const expected of ["startup", "bundle", "database", "server", "p3-client"]) {
    if (!byName[expected]) throw new Error(`Missing required performance fragment: ${expected}`);
  }
  const baseline = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    label: "v1-baseline",
    generatedAt: new Date().toISOString(),
    environment: byName.database.environment,
    environments: Object.fromEntries(
      fragments.map(({ document }) => [document.fragment, document.environment])
    ),
    fixtures: {
      database: byName.database.fixtures,
      server: byName.server.fixture,
      client: byName["p3-client"].fixture
    },
    scope: {
      releaseBaseline: "minimal-credible",
      required: [
        "empty database startup and health",
        "100k event database and common product queries",
        "Fastify child-process response and event-loop latency",
        "Chromium and WebKit typing input hot path",
        "production bundle size"
      ],
      optionalNotRun: ["1m comprehensive scale", "30-minute memory stability"]
    },
    metrics: mergeMetrics(fragments),
    fragments: fragments.map(({ evidence }) => evidence),
    source: Object.fromEntries(
      fragments.map(({ document }) => [
        document.fragment,
        basename(document.environment.command ?? "")
      ])
    )
  };
  writeJsonAtomic(options.output, baseline);
  return baseline;
}

if (resolve(process.argv[1] ?? "") === resolve(import.meta.filename)) {
  const options = parseArguments(process.argv.slice(2));
  const baseline = assembleBaseline(options);
  process.stdout.write(
    `${JSON.stringify({ output: options.output, metrics: Object.keys(baseline.metrics).length })}\n`
  );
}
