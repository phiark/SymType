import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TestInfo } from "@playwright/test";

export function observationPath(project: string, name: string): string {
  const output = resolve(
    process.env.SYMTYPE_PERF_OBSERVATION_DIR ?? ".symtype-perf-data/observations"
  );
  mkdirSync(output, { recursive: true });
  return resolve(output, `${project}.${name}.json`);
}

export async function saveObservation(
  testInfo: TestInfo,
  name: string,
  value: unknown
): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(observationPath(testInfo.project.name, name), text, "utf8");
  await testInfo.attach(`${name}.json`, { body: text, contentType: "application/json" });
}
