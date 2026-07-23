#!/usr/bin/env node

/* global process */

import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { MACOS_RELEASE } from "./release-config.mjs";
import {
  createApplicationsSymlink,
  parseCliArguments,
  runCommand,
  sha256File,
  verifyReleaseManifest
} from "./release-lib.mjs";

export async function inspectMountedDmg(directory) {
  const entries = (await readdir(directory)).sort();
  const expectedEntries = ["Applications", `${MACOS_RELEASE.productName}.app`];
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      `DMG top level must contain only ${expectedEntries.join(" and ")}, received ${entries.join(", ")}`
    );
  }
  const applications = join(directory, "Applications");
  const applicationsStat = await lstat(applications);
  if (!applicationsStat.isSymbolicLink()) {
    throw new Error("DMG Applications entry must be a symlink to /Applications");
  }
  const applicationsTarget = await readlink(applications);
  if (applicationsTarget !== "/Applications") {
    throw new Error("DMG Applications entry must be a symlink to /Applications");
  }
  const mountedApp = join(directory, `${MACOS_RELEASE.productName}.app`);
  if (!(await lstat(mountedApp)).isDirectory()) {
    throw new Error("DMG SymType.app entry must be an application directory");
  }
  return { readOnly: true, entries, applicationsTarget };
}

export async function verifyMountedApplication(
  appPath,
  {
    verifySignature = async (path) =>
      await runCommand(
        "/usr/bin/codesign",
        ["--verify", "--deep", "--strict", "--verbose=2", path],
        { capture: true, quiet: true }
      ),
    verifyManifest = verifyReleaseManifest
  } = {}
) {
  await verifySignature(appPath);
  const manifest = await verifyManifest(appPath);
  return {
    signatureVerified: true,
    manifestVerified: true,
    manifestCommitSha: manifest.commitSha,
    manifestResourceCount: manifest.resources.length
  };
}

export async function createDmg({ appPath, destination, stagingDirectory }) {
  const appStat = await stat(appPath);
  if (!appStat.isDirectory() || !appPath.endsWith(".app")) {
    throw new Error(`Expected an application bundle: ${appPath}`);
  }

  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });
  await cp(appPath, join(stagingDirectory, basename(appPath)), {
    recursive: true,
    preserveTimestamps: true
  });
  await createApplicationsSymlink(stagingDirectory);
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { force: true });

  await runCommand("/usr/bin/hdiutil", [
    "create",
    "-volname",
    MACOS_RELEASE.productName,
    "-srcfolder",
    stagingDirectory,
    "-format",
    "UDZO",
    "-ov",
    destination
  ]);
  await runCommand("/usr/bin/hdiutil", ["verify", destination]);
  const inspectionDirectory = `${stagingDirectory}-readonly-inspection`;
  await rm(inspectionDirectory, { recursive: true, force: true });
  await mkdir(inspectionDirectory, { recursive: true });
  let attached = false;
  let inspection;
  try {
    await runCommand("/usr/bin/hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      inspectionDirectory,
      destination
    ]);
    attached = true;
    const layoutInspection = await inspectMountedDmg(inspectionDirectory);
    const mountedApp = join(inspectionDirectory, `${MACOS_RELEASE.productName}.app`);
    const applicationInspection = await verifyMountedApplication(mountedApp);
    inspection = {
      ...layoutInspection,
      ...applicationInspection
    };
  } finally {
    if (attached) {
      await runCommand("/usr/bin/hdiutil", ["detach", inspectionDirectory]);
    }
    await rm(inspectionDirectory, { recursive: true, force: true });
  }

  const dmgStat = await stat(destination);
  if (dmgStat.size > MACOS_RELEASE.dmgSizeLimitBytes) {
    throw new Error(
      `${basename(destination)} is ${(dmgStat.size / 1024 / 1024).toFixed(2)} MiB; the limit is 120 MiB`
    );
  }
  const sha256 = await sha256File(destination);
  const checksumPath = `${destination}.sha256`;
  await writeFile(checksumPath, `${sha256}  ${basename(destination)}\n`, { mode: 0o644 });
  return { destination, checksumPath, bytes: dmgStat.size, sha256, inspection };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseCliArguments(process.argv.slice(2));
  if (typeof options.app !== "string" || typeof options.output !== "string") {
    throw new Error(
      "Usage: node scripts/macos/create-dmg.mjs --app /path/SymType.app --output /path/SymType.dmg"
    );
  }
  const destination = resolve(options.output);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "symtype-dmg-"));
  try {
    const result = await createDmg({
      appPath: resolve(options.app),
      destination,
      stagingDirectory: join(temporaryRoot, "staging")
    });
    process.stdout.write(`${JSON.stringify({ status: "pass", ...result }, null, 2)}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
