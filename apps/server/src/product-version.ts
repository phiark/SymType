import { readFileSync } from "node:fs";

interface PackageMetadata {
  version?: unknown;
}

function readProductVersion(): string {
  const metadata = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as PackageMetadata;
  if (typeof metadata.version !== "string" || metadata.version.trim().length === 0) {
    throw new Error("@symtype/server package metadata does not contain a product version.");
  }
  return metadata.version;
}

export const PRODUCT_VERSION = readProductVersion();
