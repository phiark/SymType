export const MACOS_RELEASE = Object.freeze({
  productName: "SymType",
  productVersion: "2.1.0",
  buildNumber: "1",
  bundleIdentifier: "com.zerolab.symtype",
  architecture: "arm64",
  minimumMacOS: "15.0",
  nodeVersion: "24.18.0",
  nodeAbi: "137",
  nodeArchiveName: "node-v24.18.0-darwin-arm64.tar.xz",
  nodeArchiveSha256: "4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6",
  nodeDownloadBaseUrl: "https://nodejs.org/download/release/v24.18.0",
  appSizeLimitBytes: 200 * 1024 * 1024,
  dmgSizeLimitBytes: 120 * 1024 * 1024
});

export const APP_RESOURCE_TOP_LEVEL_ALLOWLIST = Object.freeze([
  "node_modules",
  "package.json",
  "server",
  "web"
]);

export const RUNTIME_PACKAGE_EXCLUDED_DIRECTORIES = Object.freeze(
  new Set([
    ".cache",
    ".github",
    ".nyc_output",
    "__tests__",
    "benchmark",
    "benchmarks",
    "coverage",
    "docs",
    "example",
    "examples",
    "test",
    "tests"
  ])
);

export const RUNTIME_PACKAGE_EXCLUDED_SUFFIXES = Object.freeze([
  ".cts",
  ".map",
  ".mts",
  ".ts",
  ".tsx"
]);
