#!/usr/bin/env node

/* global console, process */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { writeJsonAtomic } from "./lib/index.js";
import { readViteManifest } from "./p2-bundle-graph.mjs";
import {
  bundleChecksPass,
  collectBundleEvidence,
  createBundleFragment
} from "./p2-bundle-report.mjs";
import { routeEvidence, runCleanProductionBuild } from "./p2-bundle-runtime.mjs";
import { assertSupportedPerformanceRuntime, projectRoot } from "./p2-process.mjs";

const WEB_DIST = join(projectRoot, "apps/web/dist");
const DEFAULT_OUTPUT = join(projectRoot, "reports/performance/fragments/bundle.json");

export function parseBundleArguments(arguments_) {
  const options = { output: DEFAULT_OUTPUT, build: true };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--output") {
      const value = arguments_[++index];
      if (!value) throw new Error("--output requires a value.");
      options.output = resolve(value);
    } else if (argument === "--no-build") options.build = false;
    else if (argument === "--enforce") options.enforce = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node --import tsx scripts/perf/run-bundle.mjs [options]

  --no-build        Inspect the current manifest build without rebuilding
  --output PATH     Atomic JSON fragment path
  --enforce         Fail when a resource budget or exclusion check fails`);
}

export async function runBundle(options) {
  assertSupportedPerformanceRuntime();
  const build = options.build
    ? runCleanProductionBuild()
    : { clean: false, reason: "--no-build requested; result is not clean-build release evidence" };
  const manifestPath = join(WEB_DIST, ".vite/manifest.json");
  if (!existsSync(manifestPath)) throw new Error("A Vite manifest build is required.");
  const manifest = readViteManifest(WEB_DIST);
  const routes = routeEvidence(manifest, WEB_DIST);
  const evidence = await collectBundleEvidence(manifest, routes, WEB_DIST);
  const fragment = createBundleFragment({
    build,
    evidence,
    manifest,
    manifestPath,
    options,
    routes,
    webDist: WEB_DIST
  });
  writeJsonAtomic(options.output, fragment);
  if (options.enforce && !bundleChecksPass(fragment)) process.exitCode = 1;
  return fragment;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = parseBundleArguments(process.argv.slice(2));
  if (options.help) printHelp();
  else await runBundle(options);
}
