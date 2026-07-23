/* global Buffer, TextDecoder, fetch, process */

import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

import {
  APP_RESOURCE_TOP_LEVEL_ALLOWLIST,
  MACOS_RELEASE,
  RUNTIME_PACKAGE_EXCLUDED_DIRECTORIES,
  RUNTIME_PACKAGE_EXCLUDED_SUFFIXES
} from "./release-config.mjs";

const textDecoder = new TextDecoder();
const LICENSE_PATTERN = /^(licen[cs]e|notice|copying)(\..*)?$/i;

export function parseCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function verifyFileSha256(path, expectedSha256) {
  const actual = await sha256File(path);
  if (actual !== expectedSha256) {
    throw new Error(`SHA-256 mismatch for ${path}: expected ${expectedSha256}, received ${actual}`);
  }
  return actual;
}

export async function downloadVerifiedNodeArchive(destination, fetchImplementation = fetch) {
  await mkdir(dirname(destination), { recursive: true });
  if (await pathExists(destination)) {
    await verifyFileSha256(destination, MACOS_RELEASE.nodeArchiveSha256);
    return destination;
  }

  const url = `${MACOS_RELEASE.nodeDownloadBaseUrl}/${MACOS_RELEASE.nodeArchiveName}`;
  const temporaryPath = `${destination}.download`;
  await rm(temporaryPath, { force: true });
  const response = await fetchImplementation(url, { redirect: "error" });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  }

  try {
    await pipeline(response.body, createWriteStream(temporaryPath, { mode: 0o600 }));
    await verifyFileSha256(temporaryPath, MACOS_RELEASE.nodeArchiveSha256);
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return destination;
}

export async function runCommand(command, args, options = {}) {
  const display = [command, ...args].join(" ");
  if (!options.quiet) {
    process.stdout.write(`+ ${display}\n`);
  }

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      const result = {
        code,
        signal,
        stdout: textDecoder.decode(Buffer.concat(stdout)).trim(),
        stderr: textDecoder.decode(Buffer.concat(stderr)).trim()
      };
      if (code === 0) {
        resolvePromise(result);
        return;
      }
      rejectPromise(
        new Error(
          `${display} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}${
            result.stderr ? `\n${result.stderr}` : ""
          }`
        )
      );
    });
  });
}

export function createNodeBuildEnvironment(
  nodeRoot,
  npmCacheDirectory,
  baseEnvironment = process.env
) {
  const environment = { ...baseEnvironment };
  for (const name of Object.keys(environment)) {
    if (
      name === "NODE_OPTIONS" ||
      name === "NODE_PATH" ||
      name.startsWith("DYLD_") ||
      name.startsWith("npm_config_target") ||
      name === "npm_config_arch" ||
      name === "npm_config_platform"
    ) {
      delete environment[name];
    }
  }

  environment.PATH = [join(nodeRoot, "bin"), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  environment.npm_config_cache = npmCacheDirectory;
  environment.npm_config_nodedir = nodeRoot;
  environment.npm_config_audit = "false";
  environment.npm_config_fund = "false";
  environment.npm_config_update_notifier = "false";
  environment.MACOSX_DEPLOYMENT_TARGET = MACOS_RELEASE.minimumMacOS;
  return environment;
}

export async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(path);
      }
    }
  }
  if (await pathExists(root)) {
    await visit(root);
  }
  return files;
}

export function shouldIncludeRuntimePackagePath(relativePath) {
  if (!relativePath) return true;
  const components = relativePath.split(sep);
  if (
    components.some((component) =>
      RUNTIME_PACKAGE_EXCLUDED_DIRECTORIES.has(component.toLowerCase())
    )
  ) {
    return false;
  }
  const lowerName = components.at(-1).toLowerCase();
  if (RUNTIME_PACKAGE_EXCLUDED_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) {
    return false;
  }
  if (lowerName.endsWith(".md") && !LICENSE_PATTERN.test(lowerName)) {
    return false;
  }
  return true;
}

export async function copyRuntimeTree(source, destination) {
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    filter: (candidate) => shouldIncludeRuntimePackagePath(relative(source, candidate))
  });
}

async function resolveInstalledPackage(sourceRoot, fromDirectory, packageName) {
  let cursor = resolve(fromDirectory);
  const absoluteRoot = resolve(sourceRoot);
  while (cursor === absoluteRoot || cursor.startsWith(`${absoluteRoot}${sep}`)) {
    const candidate = join(cursor, "node_modules", ...packageName.split("/"));
    if (await pathExists(join(candidate, "package.json"))) {
      return candidate;
    }
    if (cursor === absoluteRoot) break;
    cursor = dirname(cursor);
  }
  return null;
}

function packageDependencies(manifest) {
  const requiredPeerDependencies = Object.fromEntries(
    Object.entries(manifest.peerDependencies ?? {}).filter(
      ([name]) => manifest.peerDependenciesMeta?.[name]?.optional !== true
    )
  );
  return {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...requiredPeerDependencies
  };
}

export async function copyProductionDependencyClosure({
  sourceRoot,
  destinationRoot,
  entryDirectory,
  directDependencies
}) {
  const queue = Object.keys(directDependencies)
    .filter((name) => !name.startsWith("@symtype/"))
    .map((name) => ({ fromDirectory: entryDirectory, name, optional: false }));
  const seen = new Set();
  const packages = [];

  while (queue.length > 0) {
    const request = queue.shift();
    const sourceDirectory = await resolveInstalledPackage(
      sourceRoot,
      request.fromDirectory,
      request.name
    );
    if (!sourceDirectory) {
      if (request.optional) continue;
      throw new Error(
        `Production dependency ${request.name} was not installed from ${request.fromDirectory}`
      );
    }
    const installPath = relative(sourceRoot, sourceDirectory);
    if (seen.has(installPath)) continue;
    seen.add(installPath);

    const manifest = JSON.parse(await readFile(join(sourceDirectory, "package.json"), "utf8"));
    const destinationDirectory = join(destinationRoot, installPath);
    await copyRuntimeTree(sourceDirectory, destinationDirectory);
    packages.push({
      name: manifest.name,
      version: manifest.version,
      license: manifest.license ?? "UNKNOWN",
      installPath: installPath.split(sep).join("/")
    });

    const optionalNames = new Set(Object.keys(manifest.optionalDependencies ?? {}));
    for (const name of Object.keys(packageDependencies(manifest)).sort()) {
      if (name.startsWith("@symtype/")) continue;
      queue.push({
        fromDirectory: sourceDirectory,
        name,
        optional: optionalNames.has(name)
      });
    }
  }

  return packages.sort((left, right) => left.installPath.localeCompare(right.installPath));
}

export async function copyInternalRuntimePackage(sourceRoot, destinationRoot, packagePath) {
  const sourceDirectory = join(sourceRoot, packagePath);
  const manifest = JSON.parse(await readFile(join(sourceDirectory, "package.json"), "utf8"));
  const destinationDirectory = join(destinationRoot, "node_modules", ...manifest.name.split("/"));
  await mkdir(destinationDirectory, { recursive: true });
  await copyFile(join(sourceDirectory, "package.json"), join(destinationDirectory, "package.json"));
  await copyRuntimeTree(join(sourceDirectory, "dist"), join(destinationDirectory, "dist"));
  return {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license ?? "SEE PROJECT LICENSE",
    installPath: relative(destinationRoot, destinationDirectory).split(sep).join("/")
  };
}

export async function collectLicenseFiles(sourceRoot, packages, destinationRoot) {
  for (const packageRecord of packages) {
    const sourceDirectory = join(sourceRoot, packageRecord.installPath);
    if (!(await pathExists(sourceDirectory))) continue;
    for (const file of await listFiles(sourceDirectory)) {
      const name = basename(file);
      if (!LICENSE_PATTERN.test(name)) continue;
      const destination = join(destinationRoot, packageRecord.installPath, name);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(file, destination);
    }
  }
}

export function createSpdxDocument({ packages, commitSha, created }) {
  const records = [
    {
      name: "SymType",
      version: MACOS_RELEASE.productVersion,
      license: "SEE PROJECT LICENSE",
      installPath: "."
    },
    {
      name: "Node.js",
      version: MACOS_RELEASE.nodeVersion,
      license: "MIT",
      installPath: "Contents/Helpers/node"
    },
    ...packages
  ].map((packageRecord, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: packageRecord.name,
    versionInfo: packageRecord.version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared:
      typeof packageRecord.license === "string" ? packageRecord.license : "NOASSERTION",
    copyrightText: "NOASSERTION",
    comment: `Installed path: ${packageRecord.installPath}`
  }));
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `SymType-${MACOS_RELEASE.productVersion}-macos-arm64`,
    documentNamespace: `urn:symtype:spdx:${commitSha}`,
    creationInfo: {
      created,
      creators: ["Tool: scripts/macos/build-release.mjs"]
    },
    packages: records,
    relationships: records.map((record) => ({
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: record.SPDXID
    }))
  };
}

export async function assertAppResourceAllowlist(appResourcesDirectory) {
  const entries = await readdir(appResourcesDirectory);
  const unexpected = entries
    .filter((entry) => !APP_RESOURCE_TOP_LEVEL_ALLOWLIST.includes(entry))
    .sort();
  if (unexpected.length > 0) {
    throw new Error(`Unexpected runtime resource entries: ${unexpected.join(", ")}`);
  }

  const forbidden = [];
  for (const file of await listFiles(appResourcesDirectory)) {
    const rel = relative(appResourcesDirectory, file);
    if (!shouldIncludeRuntimePackagePath(rel)) forbidden.push(rel);
  }
  if (forbidden.length > 0) {
    throw new Error(`Forbidden development files in runtime resources: ${forbidden.join(", ")}`);
  }
}

export async function createReleaseManifest(appPath, metadata) {
  const contentsPath = join(appPath, "Contents");
  const manifestPath = join(contentsPath, "Resources", "release-manifest.json");
  const roots = [join(contentsPath, "Helpers"), join(contentsPath, "Resources")];
  const files = [];

  for (const root of roots) {
    for (const file of await listFiles(root)) {
      if (resolve(file) === resolve(manifestPath)) continue;
      const fileStat = await stat(file);
      files.push({
        path: relative(contentsPath, file).split(sep).join("/"),
        bytes: fileStat.size,
        sha256: await sha256File(file)
      });
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));

  const manifest = {
    schemaVersion: 1,
    productVersion: MACOS_RELEASE.productVersion,
    buildNumber: Number(metadata.buildNumber),
    commitSha: metadata.commitSha,
    architecture: MACOS_RELEASE.architecture,
    minimumMacOS: MACOS_RELEASE.minimumMacOS,
    nodeVersion: MACOS_RELEASE.nodeVersion,
    nodeAbi: Number(MACOS_RELEASE.nodeAbi),
    resources: files
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return manifest;
}

export async function verifyReleaseManifest(appPath) {
  const contentsPath = join(appPath, "Contents");
  const manifestPath = join(contentsPath, "Resources", "release-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const expected = {
    schemaVersion: 1,
    productVersion: MACOS_RELEASE.productVersion,
    architecture: MACOS_RELEASE.architecture,
    minimumMacOS: MACOS_RELEASE.minimumMacOS,
    nodeVersion: MACOS_RELEASE.nodeVersion,
    nodeAbi: Number(MACOS_RELEASE.nodeAbi)
  };
  for (const [field, value] of Object.entries(expected)) {
    if (manifest[field] !== value) {
      throw new Error(`release-manifest.json ${field} must be ${value}`);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.commitSha)) {
    throw new Error("release-manifest.json commitSha must be a full Git SHA-1");
  }
  if (!Number.isSafeInteger(manifest.buildNumber) || manifest.buildNumber < 1) {
    throw new Error("release-manifest.json buildNumber must be a positive integer");
  }
  if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) {
    throw new Error("release-manifest.json resources must be a non-empty array");
  }

  const seen = new Set();
  for (const resource of manifest.resources) {
    if (
      typeof resource.path !== "string" ||
      !Number.isSafeInteger(resource.bytes) ||
      !/^[0-9a-f]{64}$/.test(resource.sha256)
    ) {
      throw new Error("release-manifest.json contains an invalid resource record");
    }
    if (
      resource.path.startsWith("/") ||
      resource.path.split("/").includes("..") ||
      seen.has(resource.path)
    ) {
      throw new Error(
        `release-manifest.json contains an unsafe or duplicate path: ${resource.path}`
      );
    }
    seen.add(resource.path);
    const file = join(contentsPath, ...resource.path.split("/"));
    const fileStat = await stat(file);
    if (fileStat.size !== resource.bytes) {
      throw new Error(`Release resource size mismatch: ${resource.path}`);
    }
    await verifyFileSha256(file, resource.sha256);
  }
  const actual = new Set();
  for (const root of [join(contentsPath, "Helpers"), join(contentsPath, "Resources")]) {
    for (const file of await listFiles(root)) {
      if (resolve(file) === resolve(manifestPath)) continue;
      actual.add(relative(contentsPath, file).split(sep).join("/"));
    }
  }
  const unlisted = [...actual].filter((path) => !seen.has(path)).sort();
  const missing = [...seen].filter((path) => !actual.has(path)).sort();
  if (unlisted.length > 0 || missing.length > 0) {
    throw new Error(
      `Release manifest coverage mismatch; unlisted=${unlisted.join(",") || "none"}; ` +
        `missing=${missing.join(",") || "none"}`
    );
  }
  return manifest;
}

export async function directorySize(root) {
  let total = 0;
  for (const file of await listFiles(root)) {
    const fileStat = await lstat(file);
    if (fileStat.isFile()) total += fileStat.size;
  }
  return total;
}

export async function createApplicationsSymlink(directory) {
  const destination = join(directory, "Applications");
  await rm(destination, { force: true });
  await symlink("/Applications", destination);
}

export async function copyExecutable(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
}
