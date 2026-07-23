import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectMountedDmg, verifyMountedApplication } from "./create-dmg.mjs";
import { createApplicationsSymlink } from "./release-lib.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("DMG mount inspection", () => {
  it("accepts exactly SymType.app and the Applications symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "symtype-dmg-test-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "SymType.app"));
    await createApplicationsSymlink(directory);

    await expect(inspectMountedDmg(directory)).resolves.toEqual({
      readOnly: true,
      entries: ["Applications", "SymType.app"],
      applicationsTarget: "/Applications"
    });
  });

  it("rejects any unexpected top-level entry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "symtype-dmg-test-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "SymType.app"));
    await createApplicationsSymlink(directory);
    await writeFile(join(directory, "README.txt"), "unexpected");

    await expect(inspectMountedDmg(directory)).rejects.toThrow("must contain only");
  });

  it("verifies the signature and complete manifest from the mounted application", async () => {
    const events = [];
    const commitSha = "a".repeat(40);
    const result = await verifyMountedApplication("/Volumes/SymType/SymType.app", {
      verifySignature: async (path) => events.push(`signature:${path}`),
      verifyManifest: async (path) => {
        events.push(`manifest:${path}`);
        return { commitSha, resources: [{ path: "Helpers/node" }, { path: "server/index.js" }] };
      }
    });

    expect(events).toEqual([
      "signature:/Volumes/SymType/SymType.app",
      "manifest:/Volumes/SymType/SymType.app"
    ]);
    expect(result).toEqual({
      signatureVerified: true,
      manifestVerified: true,
      manifestCommitSha: commitSha,
      manifestResourceCount: 2
    });
  });
});
