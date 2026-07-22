import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";

export function writeJsonAtomic(path: string, value: unknown): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.tmp`);
  const descriptor = openSync(temporaryPath, "w", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function readJsonFile<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
