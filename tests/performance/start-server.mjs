import {
  copyFixtureDatabase,
  createTrialDataDirectory,
  removeTrialDirectory,
  startProductionServer,
  stopOwnedProcess
} from "../../scripts/perf/p2-process.mjs";
import process from "node:process";

const runId = process.env.SYMTYPE_PERF_RUN_ID ?? "manual";
if (!/^[a-z0-9._-]+$/iu.test(runId)) throw new Error("Invalid performance run ID");
const trial = createTrialDataDirectory(`p3-${runId}`);
copyFixtureDatabase(process.env.SYMTYPE_PERF_FIXTURE_PATH?.trim(), trial.dataDir);
const server = await startProductionServer({
  dataDir: trial.dataDir,
  port: Number(process.env.SYMTYPE_PERF_PORT ?? "4283")
});

let stopping = false;
const stop = async (exitCode) => {
  if (stopping) return;
  stopping = true;
  await stopOwnedProcess(server.child);
  removeTrialDirectory(trial.trialRoot);
  process.exit(exitCode);
};
process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));
server.child.once("exit", (code) => void stop(code ?? 1));
await new Promise(() => undefined);
