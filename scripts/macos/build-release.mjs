#!/usr/bin/env node

/* global process */

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDmg } from "./create-dmg.mjs";
import { createIcon } from "./create-icon.mjs";
import { auditApplication, signApplicationInsideOut } from "./platform-audit.mjs";
import { MACOS_RELEASE } from "./release-config.mjs";
import {
  assertAppResourceAllowlist,
  collectLicenseFiles,
  copyExecutable,
  copyInternalRuntimePackage,
  copyProductionDependencyClosure,
  copyRuntimeTree,
  createSpdxDocument,
  createNodeBuildEnvironment,
  createReleaseManifest,
  downloadVerifiedNodeArchive,
  parseCliArguments,
  pathExists,
  runCommand,
  verifyFileSha256,
  writeJson
} from "./release-lib.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");

async function assertReleaseCheckout(commit) {
  const status = await runCommand(
    "/usr/bin/git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd: repositoryRoot, capture: true, quiet: true }
  );
  if (status.stdout) {
    throw new Error(
      "Refusing to package tracked working-tree changes. Commit the Issue branch before release packaging."
    );
  }
  const revision = await runCommand("/usr/bin/git", ["rev-parse", `${commit}^{commit}`], {
    cwd: repositoryRoot,
    capture: true,
    quiet: true
  });
  if (!/^[0-9a-f]{40}$/.test(revision.stdout)) {
    throw new Error(`Unable to resolve a full commit SHA for ${commit}`);
  }
  return revision.stdout;
}

async function extractNodeArchive(archivePath, destination) {
  await mkdir(destination, { recursive: true });
  await runCommand("/usr/bin/tar", ["-xJf", archivePath, "-C", destination]);
  const nodeRoot = join(destination, MACOS_RELEASE.nodeArchiveName.replace(/\.tar\.xz$/, ""));
  if (!(await pathExists(join(nodeRoot, "bin", "node")))) {
    throw new Error(`Node archive did not contain the expected runtime root: ${nodeRoot}`);
  }
  return nodeRoot;
}

async function createCleanSource(commitSha, destination) {
  await mkdir(destination, { recursive: true });
  const archive = join(dirname(destination), "source.tar");
  await runCommand("/usr/bin/git", ["archive", "--format=tar", `--output=${archive}`, commitSha], {
    cwd: repositoryRoot
  });
  await runCommand("/usr/bin/tar", ["-xf", archive, "-C", destination]);
  return destination;
}

async function verifyBuildRuntime(node, expectedAbi, cwd) {
  const runtime = await runCommand(
    node,
    [
      "--input-type=commonjs",
      "-e",
      [
        'const Database=require("better-sqlite3");',
        'const db=new Database(":memory:");',
        'db.prepare("select 1").get();',
        "db.close();",
        "process.stdout.write(JSON.stringify({",
        "version:process.versions.node,",
        "abi:process.versions.modules,",
        "arch:process.arch",
        "}));"
      ].join("")
    ],
    { cwd, capture: true, quiet: true }
  );
  const result = JSON.parse(runtime.stdout);
  if (
    result.version !== MACOS_RELEASE.nodeVersion ||
    result.arch !== MACOS_RELEASE.architecture ||
    result.abi !== expectedAbi
  ) {
    throw new Error(
      `Wrong release runtime: expected Node ${MACOS_RELEASE.nodeVersion}/${expectedAbi}/arm64, ` +
        `received ${result.version}/${result.abi}/${result.arch}`
    );
  }
  return result;
}

async function buildCleanSource({ sourceRoot, nodeRoot, npmCache }) {
  const node = join(nodeRoot, "bin", "node");
  const npmCli = join(nodeRoot, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const environment = createNodeBuildEnvironment(nodeRoot, npmCache);
  const npm = async (...args) =>
    await runCommand(node, [npmCli, ...args], { cwd: sourceRoot, env: environment });

  await npm("ci", "--no-audit", "--no-fund");
  // Release inputs are accepted only after the clean archive passes the same
  // lint, type, unit/integration, fixed-output regression, and production
  // build gate as a source release. `check` ends with the production build.
  await npm("run", "check");
  await npm("prune", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund");

  const rebuildEnvironment = {
    ...environment,
    npm_config_build_from_source: "true",
    npm_config_offline: "true"
  };
  await runCommand(node, [npmCli, "rebuild", "better-sqlite3", "--foreground-scripts"], {
    cwd: sourceRoot,
    env: rebuildEnvironment
  });
  await verifyBuildRuntime(node, MACOS_RELEASE.nodeAbi, sourceRoot);
}

async function buildNativeApplication(sourceRoot, derivedDataPath, buildNumber) {
  const project = join(sourceRoot, "apps", "macos", "SymType.xcodeproj");
  if (!(await pathExists(project))) {
    throw new Error(`Native project is missing from the release commit: ${project}`);
  }
  await createIcon({
    source: join(sourceRoot, "apps", "macos", "SymType", "Resources", "AppIcon-master.png"),
    destination: join(sourceRoot, "apps", "macos", "SymType", "Resources", "AppIcon.icns")
  });
  await runCommand("/usr/bin/xcodebuild", [
    "-project",
    project,
    "-scheme",
    "SymType",
    "-configuration",
    "Release",
    "-derivedDataPath",
    derivedDataPath,
    "-destination",
    "platform=macOS,arch=arm64",
    "CODE_SIGNING_ALLOWED=NO",
    "ONLY_ACTIVE_ARCH=YES",
    "ARCHS=arm64",
    `MACOSX_DEPLOYMENT_TARGET=${MACOS_RELEASE.minimumMacOS}`,
    `CURRENT_PROJECT_VERSION=${buildNumber}`,
    `MARKETING_VERSION=${MACOS_RELEASE.productVersion}`,
    `PRODUCT_BUNDLE_IDENTIFIER=${MACOS_RELEASE.bundleIdentifier}`,
    "clean",
    "build"
  ]);
  const product = join(
    derivedDataPath,
    "Build",
    "Products",
    "Release",
    `${MACOS_RELEASE.productName}.app`
  );
  if (!(await pathExists(product))) {
    throw new Error(`xcodebuild did not produce ${product}`);
  }
  return product;
}

async function assembleApplication({
  sourceRoot,
  nodeRoot,
  nativeProduct,
  appPath,
  commitSha,
  commitTimestamp,
  buildNumber
}) {
  await rm(appPath, { recursive: true, force: true });
  await copyRuntimeTree(nativeProduct, appPath);
  const contents = join(appPath, "Contents");
  const resources = join(contents, "Resources");
  const appResources = join(resources, "app");
  const licenses = join(resources, "licenses");
  await rm(join(contents, "Helpers"), { recursive: true, force: true });
  await rm(appResources, { recursive: true, force: true });
  await rm(licenses, { recursive: true, force: true });
  await mkdir(appResources, { recursive: true });
  await mkdir(licenses, { recursive: true });

  await copyExecutable(join(nodeRoot, "bin", "node"), join(contents, "Helpers", "node"));
  await copyRuntimeTree(join(sourceRoot, "apps", "server", "dist"), join(appResources, "server"));
  await copyRuntimeTree(
    join(sourceRoot, "apps", "server", "package.json"),
    join(appResources, "server", "package.json")
  );
  await copyRuntimeTree(join(sourceRoot, "apps", "web", "dist"), join(appResources, "web"));

  const serverManifest = JSON.parse(
    await readFile(join(sourceRoot, "apps", "server", "package.json"), "utf8")
  );
  const externalPackages = await copyProductionDependencyClosure({
    sourceRoot,
    destinationRoot: appResources,
    entryDirectory: join(sourceRoot, "apps", "server"),
    directDependencies: serverManifest.dependencies
  });
  const internalPackages = [
    await copyInternalRuntimePackage(sourceRoot, appResources, join("packages", "content")),
    await copyInternalRuntimePackage(sourceRoot, appResources, join("packages", "shared"))
  ];
  const packages = [...externalPackages, ...internalPackages].sort((left, right) =>
    left.installPath.localeCompare(right.installPath)
  );

  await writeJson(join(appResources, "package.json"), {
    name: "symtype-desktop-runtime",
    version: MACOS_RELEASE.productVersion,
    private: true,
    type: "module",
    main: "server/index.js"
  });
  await collectLicenseFiles(sourceRoot, packages, join(licenses, "npm"));
  await writeJson(join(licenses, "npm-packages.json"), {
    schemaVersion: 1,
    packages
  });
  await writeJson(
    join(licenses, "sbom.spdx.json"),
    createSpdxDocument({ packages, commitSha, created: commitTimestamp })
  );
  await copyRuntimeTree(join(nodeRoot, "LICENSE"), join(licenses, "Node-LICENSE"));
  await copyRuntimeTree(join(sourceRoot, "LICENSE"), join(licenses, "SymType-LICENSE"));
  await copyRuntimeTree(
    join(sourceRoot, "THIRD_PARTY_NOTICES.md"),
    join(licenses, "THIRD_PARTY_NOTICES.md")
  );

  await assertAppResourceAllowlist(appResources);
  await verifyBuildRuntime(join(contents, "Helpers", "node"), MACOS_RELEASE.nodeAbi, appResources);

  await signApplicationInsideOut(appPath, {
    nodeEntitlements: join(sourceRoot, "apps", "macos", "SymType", "Node.entitlements")
  });
  await createReleaseManifest(appPath, { buildNumber, commitSha });
  await runCommand("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", appPath]);
}

export async function buildRelease(options = {}) {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("SymType macOS releases must be built on an Apple Silicon macOS host");
  }
  const buildNumber = String(options.buildNumber ?? MACOS_RELEASE.buildNumber);
  if (!/^[1-9][0-9]*$/.test(buildNumber)) {
    throw new Error(`Build number must be a positive integer: ${buildNumber}`);
  }

  const commitSha = await assertReleaseCheckout(options.commit ?? "HEAD");
  const commitTimestamp = new Date(
    (
      await runCommand("/usr/bin/git", ["show", "-s", "--format=%cI", commitSha], {
        cwd: repositoryRoot,
        capture: true,
        quiet: true
      })
    ).stdout
  ).toISOString();
  const outputDirectory = resolve(options.outputDirectory ?? join(repositoryRoot, "dist", "macos"));
  const workRoot = await mkdtemp(join(tmpdir(), "symtype-macos-release-"));
  const cacheDirectory = join(outputDirectory, "cache");
  const archivePath = resolve(
    options.nodeArchive ?? join(cacheDirectory, MACOS_RELEASE.nodeArchiveName)
  );
  const appPath = join(outputDirectory, `${MACOS_RELEASE.productName}.app`);
  const dmgPath = join(
    outputDirectory,
    `${MACOS_RELEASE.productName}-${MACOS_RELEASE.productVersion}-macos-arm64.dmg`
  );

  try {
    if (options.nodeArchive) {
      await verifyFileSha256(archivePath, MACOS_RELEASE.nodeArchiveSha256);
    } else {
      await downloadVerifiedNodeArchive(archivePath);
    }
    const nodeRoot = await extractNodeArchive(archivePath, join(workRoot, "node"));
    const sourceRoot = await createCleanSource(commitSha, join(workRoot, "source"));
    await buildCleanSource({
      sourceRoot,
      nodeRoot,
      npmCache: join(workRoot, "npm-cache")
    });
    const nativeProduct = await buildNativeApplication(
      sourceRoot,
      join(workRoot, "DerivedData"),
      buildNumber
    );
    await mkdir(outputDirectory, { recursive: true });
    await assembleApplication({
      sourceRoot,
      nodeRoot,
      nativeProduct,
      appPath,
      commitSha,
      commitTimestamp,
      buildNumber
    });
    const appAudit = await auditApplication(appPath, { expectedBuildNumber: buildNumber });
    const dmg = await createDmg({
      appPath,
      destination: dmgPath,
      stagingDirectory: join(workRoot, "dmg")
    });
    const result = {
      schemaVersion: 1,
      productVersion: MACOS_RELEASE.productVersion,
      buildNumber,
      commitSha,
      app: {
        path: appPath,
        bytes: appAudit.bytes,
        machOFiles: appAudit.machOFiles,
        serverSmoke: appAudit.serverSmoke
      },
      dmg
    };
    await writeFile(
      join(outputDirectory, "release-result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      { mode: 0o644 }
    );
    return result;
  } finally {
    if (!options.keepWorkDirectory) {
      await rm(workRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`Kept release work directory: ${workRoot}\n`);
    }
  }
}

if (process.argv[1] && basename(process.argv[1]) === "build-release.mjs") {
  const arguments_ = parseCliArguments(process.argv.slice(2));
  const result = await buildRelease({
    buildNumber: arguments_["build-number"],
    commit: arguments_.commit,
    outputDirectory: arguments_["output-dir"],
    nodeArchive: arguments_["node-archive"],
    keepWorkDirectory: arguments_["keep-work"] === true
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
