import { expect, test } from "@playwright/test";

import { mutate } from "./helpers";

const criticalIdleRoutes = [
  { path: "/", name: "Today" },
  { path: "/train", name: "Train" },
  { path: "/test", name: "Test" },
  { path: "/game", name: "Game" },
  { path: "/analytics", name: "Analytics" },
  { path: "/settings", name: "Settings" }
] as const;

function isAllowedTransport(url: URL, baseOrigin: string): boolean {
  if (url.protocol === "http:" || url.protocol === "https:") {
    return url.origin === baseOrigin;
  }
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    const equivalentHttpOrigin = `${url.protocol === "ws:" ? "http:" : "https:"}//${url.host}`;
    return equivalentHttpOrigin === baseOrigin;
  }
  return true;
}

test("critical idle routes stay inside the exact local runtime boundary", async ({
  page,
  request
}, testInfo) => {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(typeof configuredBaseUrl).toBe("string");
  if (typeof configuredBaseUrl !== "string") return;
  const allowedOrigin = new URL(configuredBaseUrl).origin;

  await mutate(request, "patch", "/api/v1/settings", {
    onboardingComplete: true,
    calibrationComplete: true,
    theme: "light",
    reducedMotion: true
  });

  const blockedExternalTransports: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const localServerErrors: Array<{ status: number; url: string }> = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === allowedOrigin && response.status() >= 500) {
      localServerErrors.push({ status: response.status(), url: response.url() });
    }
  });

  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!isAllowedTransport(requestUrl, allowedOrigin)) {
      blockedExternalTransports.push(requestUrl.href);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await page.routeWebSocket(/.*/u, async (webSocket) => {
    const requestUrl = new URL(webSocket.url());
    if (!isAllowedTransport(requestUrl, allowedOrigin)) {
      blockedExternalTransports.push(requestUrl.href);
      await webSocket.close({ code: 1008, reason: "External transport blocked by release test" });
      return;
    }
    webSocket.connectToServer();
  });

  for (const route of criticalIdleRoutes) {
    await page.goto(route.path);
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("#main-content h1").first(),
      `${route.name} did not render its primary heading`
    ).toBeVisible();
  }

  expect(
    blockedExternalTransports,
    `Only ${allowedOrigin} is allowed for HTTP(S) and equivalent WS(S) transports`
  ).toEqual([]);
  expect(consoleErrors, "Unexpected console.error output on critical idle routes").toEqual([]);
  expect(pageErrors, "Unexpected uncaught page errors on critical idle routes").toEqual([]);
  expect(localServerErrors, "Unexpected local HTTP 5xx responses on critical idle routes").toEqual(
    []
  );
});
