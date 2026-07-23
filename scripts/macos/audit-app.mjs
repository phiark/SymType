#!/usr/bin/env node

/* global process */

import { resolve } from "node:path";

import { auditApplication } from "./platform-audit.mjs";
import { parseCliArguments } from "./release-lib.mjs";

const options = parseCliArguments(process.argv.slice(2));
if (typeof options.app !== "string") {
  throw new Error("Usage: node scripts/macos/audit-app.mjs --app /path/to/SymType.app");
}

const result = await auditApplication(resolve(options.app), {
  skipSignature: options["skip-signature"] === true
});
process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      app: resolve(options.app),
      bytes: result.bytes,
      mebibytes: Number((result.bytes / 1024 / 1024).toFixed(2)),
      machOFiles: result.machOFiles,
      serverSmoke: result.serverSmoke
    },
    null,
    2
  )}\n`
);
