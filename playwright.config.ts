import { defineConfig, devices } from "@playwright/test";

const nodeExecutable = JSON.stringify(process.execPath);
const firstPort = Number.parseInt(process.env.SYMTYPE_E2E_BASE_PORT ?? "4173", 10);
if (!Number.isSafeInteger(firstPort) || firstPort < 1_024 || firstPort > 65_534) {
  throw new Error("SYMTYPE_E2E_BASE_PORT must leave room for two valid unprivileged ports.");
}
const chromiumURL = `http://127.0.0.1:${firstPort}`;
const webkitURL = `http://127.0.0.1:${firstPort + 1}`;
const snapshotPlatform = process.env.SYMTYPE_E2E_SNAPSHOT_SUFFIX;

export default defineConfig({
  testDir: "./tests/e2e",
  ...(snapshotPlatform
    ? {
        snapshotPathTemplate: `{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-${snapshotPlatform}{ext}`
      }
    : {}),
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: chromiumURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: [
    {
      command: `${nodeExecutable} tests/e2e/start-server.mjs chromium ${firstPort}`,
      url: `${chromiumURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `${nodeExecutable} tests/e2e/start-server.mjs webkit ${firstPort + 1}`,
      url: `${webkitURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], baseURL: chromiumURL }
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], baseURL: webkitURL }
    }
  ]
});
