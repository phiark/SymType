import { rmSync } from "node:fs";
import { delimiter, dirname, resolve, sep } from "node:path";
import process from "node:process";

const root = resolve(process.cwd());
const testRoot = resolve(root, ".symtype-test-data");
const instance = process.argv[2] ?? "default";
const requestedPort = process.argv[3] ?? "4173";
if (!/^[a-z0-9-]+$/u.test(instance) || !/^\d{2,5}$/u.test(requestedPort)) {
  throw new Error("Invalid E2E server instance or port");
}
const target = resolve(testRoot, `e2e-${instance}`);

if (!target.startsWith(`${testRoot}${sep}`)) {
  throw new Error("Refusing to clear an unscoped E2E data directory");
}

rmSync(target, { recursive: true, force: true });
process.env.PATH = [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter);
process.env.SYMTYPE_ALLOW_UNSUPPORTED_NODE ??= "1";
process.env.SYMTYPE_DATA_DIR = target;
process.env.SYMTYPE_PORT = requestedPort;
process.argv = [process.execPath, resolve(root, "scripts/start-local.mjs"), "--no-open"];
await import("../../scripts/start-local.mjs");
