/* global process */

import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  extractCoverageInstrumentation,
  extractCoverageSymbols,
  extractMacOSMinimumVersions,
  smokePackagedServer
} from "./platform-audit.mjs";

const temporaryApplications = [];

afterEach(async () => {
  await Promise.all(
    temporaryApplications.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("packaged server audit", () => {
  it("rejects LLVM profile and coverage sections from release Mach-O files", () => {
    expect(
      extractCoverageInstrumentation(`
Load command 4
      cmd LC_SEGMENT_64
  segname __DATA
  sectname __llvm_prf_cnts
Load command 5
      cmd LC_SEGMENT_64
  segname __LLVM_COV
  sectname __llvm_covmap
`)
    ).toEqual(["__llvm_prf_cnts", "__LLVM_COV", "__llvm_covmap"]);

    expect(
      extractCoverageInstrumentation(`
Load command 4
      cmd LC_SEGMENT_64
  segname __TEXT
      sectname __text
`)
    ).toEqual([]);

    expect(
      extractCoverageSymbols(`
___llvm_profile_runtime
___llvm_profile_write_file
___llvm_gcov_init
___gcov_flush
_ordinary_product_symbol
`)
    ).toEqual([
      "___llvm_profile_runtime",
      "___llvm_profile_write_file",
      "___llvm_gcov_init",
      "___gcov_flush"
    ]);
    expect(extractCoverageSymbols("_ordinary_product_symbol\n")).toEqual([]);
  });

  it("does not mistake a linker tool version for the minimum macOS version", () => {
    const loadCommands = `
Load command 9
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 11.0
      sdk 15.5
   ntools 1
     tool 3
  version 1115.7.3
Load command 10
      cmd LC_VERSION_MIN_MACOSX
  cmdsize 16
  version 10.15
      sdk 11.0
`;

    expect(extractMacOSMinimumVersions(loadCommands)).toEqual(["11.0", "10.15"]);
  });

  it("verifies readiness, health, parent ownership, and graceful EOF shutdown", async () => {
    const app = join(
      process.cwd(),
      ".symtype-test-data",
      `packaged-server-${String(process.pid)}-${String(Date.now())}.app`
    );
    temporaryApplications.push(app);
    const helpers = join(app, "Contents", "Helpers");
    const server = join(app, "Contents", "Resources", "app", "server");
    const web = join(app, "Contents", "Resources", "app", "web");
    await mkdir(helpers, { recursive: true });
    await mkdir(server, { recursive: true });
    await mkdir(web, { recursive: true });
    await writeFile(
      join(helpers, "node"),
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`
    );
    await chmod(join(helpers, "node"), 0o755);
    await writeFile(join(web, "index.html"), "<!doctype html>");
    await writeFile(join(app, "Contents", "Resources", "app", "package.json"), '{"type":"module"}');
    await writeFile(
      join(server, "index.js"),
      [
        'import fs from "node:fs";',
        'import path from "node:path";',
        "const info={",
        "protocolVersion:1,",
        'url:"http://127.0.0.1:43123",',
        "pid:process.pid,parentPid:process.ppid,startedAt:new Date().toISOString(),",
        'databasePath:path.join(process.env.SYMTYPE_DATA_DIR,"symtype.sqlite3"),',
        'productVersion:"2.1.0",buildId:process.env.SYMTYPE_BUILD_ID,',
        'distribution:"macos-app",launchNonce:process.env.SYMTYPE_DESKTOP_LAUNCH_NONCE',
        "};",
        "fs.mkdirSync(process.env.SYMTYPE_DATA_DIR,{recursive:true});",
        'fs.writeFileSync(path.join(process.env.SYMTYPE_DATA_DIR,"server-info.json"),JSON.stringify(info));',
        "process.stdin.resume();",
        'process.stdin.once("end",()=>process.exit(0));'
      ].join("")
    );

    await expect(
      smokePackagedServer(app, {
        requestHealth: async () => ({
          statusCode: 200,
          body: {
            ok: true,
            service: "symtype",
            version: "2.1.0",
            schemaVersion: 10,
            algorithmVersion: "adaptive-v1",
            integrity: { ok: true, detail: "ok" }
          }
        })
      })
    ).resolves.toMatchObject({
      schemaVersion: 10,
      algorithmVersion: "adaptive-v1",
      integrity: "ok"
    });
  });
});
