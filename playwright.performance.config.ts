import { defineConfig, devices } from "@playwright/test";

const nodeExecutable = JSON.stringify(process.execPath);
const port = Number(process.env.SYMTYPE_PERF_PORT ?? "4283");
const baseURL = `http://127.0.0.1:${port}`;
const runId = process.env.SYMTYPE_PERF_RUN_ID ?? "manual";

export default defineConfig({
  testDir: "./tests/performance",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  outputDir: `.symtype-perf-data/playwright-output/${runId}`,
  reporter: [["list"]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "UTC",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: {
    command: `${nodeExecutable} tests/performance/start-server.mjs`,
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium-release",
      use: { ...devices["Desktop Chrome"], baseURL }
    },
    {
      name: "chromium-local",
      use: { ...devices["Desktop Chrome"], baseURL }
    },
    {
      name: "webkit-local",
      use: { ...devices["Desktop Safari"], baseURL }
    },
    {
      name: "chromium-memory",
      use: { ...devices["Desktop Chrome"], baseURL }
    }
  ]
});
