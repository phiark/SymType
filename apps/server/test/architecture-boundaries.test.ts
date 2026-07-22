import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const serverSource = fileURLToPath(new URL("../src/", import.meta.url));
const sharedSource = fileURLToPath(new URL("../../../packages/shared/src/", import.meta.url));

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/u.test(path)
        ? [path]
        : [];
  });
}

describe("server architecture boundaries", () => {
  test("domain modules cannot import persistence, filesystem, config, or migrations", () => {
    const domainRoot = join(serverSource, "domain");
    const forbiddenImport =
      /from\s+["'](?:better-sqlite3|node:(?:fs|path)|\.\.\/config(?:\.js)?|\.\.\/db\/(?:database|migrations)(?:\.js)?)["']/u;
    const sqlPrimitive =
      /(?:\.prepare\s*\(|\.transaction\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b)/u;
    for (const path of sourceFiles(domainRoot)) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} imports a forbidden infrastructure module`).not.toMatch(
        forbiddenImport
      );
      expect(source, `${path} contains a persistence primitive`).not.toMatch(sqlPrimitive);
    }
  });

  test("Fastify orchestration and shared packages contain no raw SQL", () => {
    const paths = [join(serverSource, "app.ts"), ...sourceFiles(sharedSource)];
    const sqlPrimitive =
      /(?:\.prepare\s*\(|\.transaction\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b)/u;
    for (const path of paths) {
      expect(readFileSync(path, "utf8"), `${path} contains raw SQL`).not.toMatch(sqlPrimitive);
    }
  });

  test("database is a repository adapter to all three pure analysis boundaries", () => {
    const database = readFileSync(join(serverSource, "db", "database.ts"), "utf8");
    expect(database).toContain('from "../domain/session-analysis.js"');
    expect(database).toContain('from "../domain/statistics-analysis.js"');
    expect(database).toContain('from "../domain/experiment-analysis.js"');
    expect(database).toContain("return analyzeSessionErrors({");
    expect(database).toContain("return buildPeriodFeatures(rows);");
    expect(database).toContain("return buildPeriodGroups(rows);");
    expect(database).toContain("return buildExperimentReport({ settings, sessions, events });");
  });
});
