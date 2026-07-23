#!/usr/bin/env node

/* global process */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pngDimensions } from "./create-icon.mjs";
import { MACOS_RELEASE } from "./release-config.mjs";
import { parseCliArguments, pathExists, runCommand, verifyFileSha256 } from "./release-lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const options = parseCliArguments(process.argv.slice(2));

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const packagePaths = [
  "package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/content/package.json",
  "packages/shared/package.json"
];
for (const path of packagePaths) {
  const manifest = await readJson(join(repositoryRoot, path));
  if (manifest.version !== MACOS_RELEASE.productVersion) {
    throw new Error(`${path} version must be ${MACOS_RELEASE.productVersion}`);
  }
}

const lock = await readJson(join(repositoryRoot, "package-lock.json"));
for (const path of ["", "apps/server", "apps/web", "packages/content", "packages/shared"]) {
  if (lock.packages?.[path]?.version !== MACOS_RELEASE.productVersion) {
    throw new Error(`package-lock.json ${path || "root"} version is not synchronized`);
  }
}

const rootManifest = await readJson(join(repositoryRoot, "package.json"));
for (const script of [
  "macos:icon",
  "macos:validate",
  "macos:test",
  "macos:package",
  "macos:audit",
  "perf:macos:evaluate"
]) {
  if (typeof rootManifest.scripts?.[script] !== "string") {
    throw new Error(`package.json is missing ${script}`);
  }
}

const requiredPaths = [
  "apps/macos/SymType.xcodeproj/project.pbxproj",
  "apps/macos/SymType.xcodeproj/xcshareddata/xcschemes/SymType.xcscheme",
  "apps/macos/SymType/Info.plist",
  "apps/macos/SymType/Node.entitlements",
  "apps/macos/SymType/Resources/AppIcon-master.png",
  "docs/v2.1/DESKTOP-DISTRIBUTION-ADR.md",
  "docs/v2.1/PERFORMANCE-METHODOLOGY.md",
  "docs/v2.1/RELEASE-EVIDENCE.md",
  "docs/v2.1/REQUIREMENTS-MATRIX.md",
  "docs/v2.1/ROLLBACK.md"
];
for (const path of requiredPaths) {
  if (!(await pathExists(join(repositoryRoot, path)))) {
    throw new Error(`Required 2.1 release source is missing: ${path}`);
  }
}

const nativeConfiguration = await readFile(
  join(repositoryRoot, "apps/macos/SymType/Sources/Core/ProductConfiguration.swift"),
  "utf8"
);
for (const marker of [
  `bundleIdentifier = "${MACOS_RELEASE.bundleIdentifier}"`,
  `version = "${MACOS_RELEASE.productVersion}"`,
  `minimumMacOS = "${MACOS_RELEASE.minimumMacOS}"`,
  `architecture = "${MACOS_RELEASE.architecture}"`,
  `nodeVersion = "${MACOS_RELEASE.nodeVersion}"`
]) {
  if (!nativeConfiguration.includes(marker)) {
    throw new Error(`Native product configuration is missing ${marker}`);
  }
}

const xcodeProject = await readFile(
  join(repositoryRoot, "apps/macos/SymType.xcodeproj/project.pbxproj"),
  "utf8"
);
for (const marker of [
  `ARCHS = ${MACOS_RELEASE.architecture};`,
  `MACOSX_DEPLOYMENT_TARGET = ${MACOS_RELEASE.minimumMacOS};`,
  `CURRENT_PROJECT_VERSION = ${MACOS_RELEASE.buildNumber};`,
  `MARKETING_VERSION = ${MACOS_RELEASE.productVersion};`,
  `PRODUCT_BUNDLE_IDENTIFIER = ${MACOS_RELEASE.bundleIdentifier};`
]) {
  if (!xcodeProject.includes(marker)) {
    throw new Error(`Xcode project is missing ${marker}`);
  }
}

const infoPlist = await readFile(join(repositoryRoot, "apps/macos/SymType/Info.plist"), "utf8");
for (const buildSetting of [
  "PRODUCT_BUNDLE_IDENTIFIER",
  "MARKETING_VERSION",
  "CURRENT_PROJECT_VERSION"
]) {
  if (!infoPlist.includes(`<string>$(${buildSetting})</string>`)) {
    throw new Error(`Info.plist must derive ${buildSetting} from the Xcode build settings`);
  }
}

const nodeEntitlements = await readFile(
  join(repositoryRoot, "apps/macos/SymType/Node.entitlements"),
  "utf8"
);
if (!nodeEntitlements.includes("com.apple.security.cs.allow-jit")) {
  throw new Error("Node.entitlements must enable the required JIT entitlement");
}
for (const forbidden of [
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-library-validation"
]) {
  if (nodeEntitlements.includes(forbidden)) {
    throw new Error(`Node.entitlements contains forbidden entitlement ${forbidden}`);
  }
}

const icon = await readFile(
  join(repositoryRoot, "apps/macos/SymType/Resources/AppIcon-master.png")
);
const iconSize = pngDimensions(icon);
if (iconSize.width !== 1024 || iconSize.height !== 1024) {
  throw new Error("AppIcon-master.png must be 1024x1024");
}

if (typeof options["node-archive"] === "string") {
  await verifyFileSha256(resolve(options["node-archive"]), MACOS_RELEASE.nodeArchiveSha256);
}

let xcode = null;
if (process.platform === "darwin") {
  try {
    const version = await runCommand("/usr/bin/xcodebuild", ["-version"], {
      capture: true,
      quiet: true
    });
    xcode = version.stdout;
  } catch {
    xcode = null;
  }
}
const readyToPackage = process.platform === "darwin" && process.arch === "arm64" && xcode !== null;
if (options["require-toolchain"] === true && !readyToPackage) {
  throw new Error(
    "Release packaging requires Apple Silicon macOS and a complete active Xcode installation"
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      productVersion: MACOS_RELEASE.productVersion,
      bundleIdentifier: MACOS_RELEASE.bundleIdentifier,
      minimumMacOS: MACOS_RELEASE.minimumMacOS,
      architecture: MACOS_RELEASE.architecture,
      node: {
        version: MACOS_RELEASE.nodeVersion,
        abi: MACOS_RELEASE.nodeAbi,
        archive: MACOS_RELEASE.nodeArchiveName,
        sha256: MACOS_RELEASE.nodeArchiveSha256
      },
      icon: iconSize,
      tooling: {
        platform: process.platform,
        architecture: process.arch,
        xcode
      },
      readyToPackage
    },
    null,
    2
  )}\n`
);
