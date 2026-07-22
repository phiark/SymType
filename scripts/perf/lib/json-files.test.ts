import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { readJsonFile, sha256File, writeJsonAtomic } from "./json-files.js";

test("atomic JSON output round-trips and has a stable digest", async () => {
  const directory = mkdtempSync(join(tmpdir(), "symtype-perf-json-"));
  try {
    const path = join(directory, "nested", "sample.json");
    writeJsonAtomic(path, { answer: 42 });
    expect(readJsonFile(path)).toEqual({ answer: 42 });
    expect(readFileSync(path, "utf8")).toBe('{\n  "answer": 42\n}\n');
    expect(await sha256File(path)).toBe(
      "5823dd82885cb7115a6dc367851a93a23b86d80d7154cc5bd4e8e9aafee07ecd"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
