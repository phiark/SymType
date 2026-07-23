import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  copyProductionDependencyClosure,
  createSpdxDocument,
  createReleaseManifest,
  shouldIncludeRuntimePackagePath,
  verifyReleaseManifest
} from "./release-lib.mjs";

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "symtype-release-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writePackage(directory, manifest, files = {}) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(directory, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, contents);
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("macOS release staging", () => {
  it("excludes source maps, TypeScript, test folders, and caches", () => {
    expect(shouldIncludeRuntimePackagePath("index.js")).toBe(true);
    expect(shouldIncludeRuntimePackagePath("LICENSE")).toBe(true);
    expect(shouldIncludeRuntimePackagePath("index.js.map")).toBe(false);
    expect(shouldIncludeRuntimePackagePath("src/index.ts")).toBe(false);
    expect(shouldIncludeRuntimePackagePath("tests/runtime.js")).toBe(false);
    expect(shouldIncludeRuntimePackagePath("node_modules/.cache/state")).toBe(false);
  });

  it("copies only the installed production dependency closure", async () => {
    const source = await temporaryDirectory();
    const destination = await temporaryDirectory();
    const entryDirectory = join(source, "apps", "server");
    await mkdir(entryDirectory, { recursive: true });
    await writePackage(
      join(source, "node_modules", "package-a"),
      { name: "package-a", version: "1.0.0", dependencies: { "package-b": "1.0.0" } },
      {
        "index.js": "export default 1;",
        "index.js.map": "{}",
        "tests/fixture.js": "throw new Error();"
      }
    );
    await writePackage(
      join(source, "node_modules", "package-b"),
      { name: "package-b", version: "1.0.0" },
      { "index.js": "export default 2;" }
    );
    await writePackage(
      join(source, "node_modules", "dev-only"),
      { name: "dev-only", version: "1.0.0" },
      { "index.js": "export default 3;" }
    );

    const packages = await copyProductionDependencyClosure({
      sourceRoot: source,
      destinationRoot: destination,
      entryDirectory,
      directDependencies: { "package-a": "1.0.0" }
    });
    expect(packages.map((record) => record.name)).toEqual(["package-a", "package-b"]);
    await expect(
      readFile(join(destination, "node_modules", "package-a", "index.js"), "utf8")
    ).resolves.toBe("export default 1;");
    await expect(
      readFile(join(destination, "node_modules", "package-a", "index.js.map"), "utf8")
    ).rejects.toThrow();
    await expect(
      readFile(join(destination, "node_modules", "dev-only", "index.js"), "utf8")
    ).rejects.toThrow();
  });

  it("hashes every helper and resource and detects later mutation", async () => {
    const root = await temporaryDirectory();
    const app = join(root, "SymType.app");
    await mkdir(join(app, "Contents", "Helpers"), { recursive: true });
    await mkdir(join(app, "Contents", "Resources"), { recursive: true });
    await writeFile(join(app, "Contents", "Helpers", "node"), "node");
    await writeFile(join(app, "Contents", "Resources", "asset.txt"), "asset");

    const commitSha = "a".repeat(40);
    const manifest = await createReleaseManifest(app, { buildNumber: "1", commitSha });
    expect(manifest.resources.map((resource) => resource.path)).toEqual([
      "Helpers/node",
      "Resources/asset.txt"
    ]);
    await expect(verifyReleaseManifest(app)).resolves.toMatchObject({ commitSha });

    await writeFile(join(app, "Contents", "Resources", "unlisted.txt"), "unlisted");
    await expect(verifyReleaseManifest(app)).rejects.toThrow("coverage mismatch");
    await rm(join(app, "Contents", "Resources", "unlisted.txt"));

    await writeFile(join(app, "Contents", "Resources", "asset.txt"), "changed");
    await expect(verifyReleaseManifest(app)).rejects.toThrow("size mismatch");
  });

  it("creates a deterministic SPDX inventory for the staged dependency set", () => {
    const document = createSpdxDocument({
      commitSha: "b".repeat(40),
      created: "2026-07-23T00:00:00+00:00",
      packages: [
        {
          name: "example",
          version: "1.2.3",
          license: "MIT",
          installPath: "node_modules/example"
        }
      ]
    });
    expect(document).toMatchObject({
      spdxVersion: "SPDX-2.3",
      documentNamespace: `urn:symtype:spdx:${"b".repeat(40)}`
    });
    expect(document.packages.map((entry) => entry.name)).toEqual(["SymType", "Node.js", "example"]);
    expect(document.relationships).toHaveLength(3);
  });
});
