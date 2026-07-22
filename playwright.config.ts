import { defineConfig, devices } from "@playwright/test";

const nodeExecutable = JSON.stringify(process.execPath);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: [
    {
      command: `${nodeExecutable} tests/e2e/start-server.mjs chromium 4173`,
      url: "http://127.0.0.1:4173/api/v1/health",
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `${nodeExecutable} tests/e2e/start-server.mjs webkit 4174`,
      url: "http://127.0.0.1:4174/api/v1/health",
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4173" }
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], baseURL: "http://127.0.0.1:4174" }
    }
  ]
});
