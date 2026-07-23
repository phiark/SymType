#!/usr/bin/env node

/* global process */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseCliArguments } from "../macos/release-lib.mjs";
import { evaluateMacOSPerformance } from "./macos-performance-contract.mjs";

const options = parseCliArguments(process.argv.slice(2));
if (typeof options.baseline !== "string" || typeof options.packaged !== "string") {
  throw new Error(
    "Usage: node scripts/perf/evaluate-macos.mjs --baseline source.json --packaged app.json [--output evaluation.json]"
  );
}

const baseline = JSON.parse(await readFile(resolve(options.baseline), "utf8"));
const packaged = JSON.parse(await readFile(resolve(options.packaged), "utf8"));
const result = evaluateMacOSPerformance(baseline, packaged);
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (typeof options.output === "string") {
  await writeFile(resolve(options.output), serialized, { mode: 0o644 });
} else {
  process.stdout.write(serialized);
}
if (!result.pass) process.exitCode = 1;
