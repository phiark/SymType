import { loadConfig } from "./config.js";
import { SymTypeDatabase } from "./db/database.js";

if (process.platform !== "win32") process.umask(0o077);

const database = new SymTypeDatabase(loadConfig());
const check = database.integrityCheck();
if (!check.ok) {
  database.close();
  throw new Error(`SQLite integrity check failed: ${check.detail}`);
}
console.log(`SymType database is ready at schema v${database.getSchemaVersion()}.`);
database.close();
