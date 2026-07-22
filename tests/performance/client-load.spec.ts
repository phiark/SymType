import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { patchSettings } from "./api";
import { saveObservation } from "./observations";
import { installLoadProbe, readLoadObservation } from "./probes";
import type { LoadObservation } from "./types";

const practicePath = "/train/session?mode=smart&duration=5&seed=20260722";

function requiredSamples(): number {
  const requested = Number(process.env.SYMTYPE_PERF_LOAD_SAMPLES ?? "20");
  if (!Number.isInteger(requested) || requested < 1) throw new Error("Invalid load sample count");
  if (!process.env.SYMTYPE_PERF_SHORT && requested < 20) {
    throw new Error("Release load measurement requires at least 20 samples");
  }
  return requested;
}

async function setCpuRate(
  context: BrowserContext,
  page: Page,
  rate: number,
  cacheDisabled: boolean
): Promise<void> {
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
  await session.send("Network.setCacheDisabled", { cacheDisabled });
}

function watchRemoteRequests(page: Page, baseURL: string): string[] {
  const unexpected: string[] = [];
  const origin = new URL(baseURL).origin;
  page.on("request", (request) => {
    const url = request.url();
    if (/^https?:/u.test(url) && new URL(url).origin !== origin) unexpected.push(url);
  });
  return unexpected;
}

async function waitForPractice(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "今日智能课程" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(100);
}

async function collectColdSamples(
  browser: Browser,
  baseURL: string,
  count: number,
  releaseProfile: boolean
): Promise<LoadObservation[]> {
  const results: LoadObservation[] = [];
  for (let index = 0; index < count; index += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const unexpected = watchRemoteRequests(page, baseURL);
    await installLoadProbe(page);
    if (releaseProfile) await setCpuRate(context, page, 4, true);
    await page.goto(practicePath, { waitUntil: "domcontentloaded" });
    await waitForPractice(page);
    results.push(await readLoadObservation(page, unexpected));
    await context.close();
  }
  return results;
}

async function collectWarmSamples(
  browser: Browser,
  baseURL: string,
  count: number,
  releaseProfile: boolean
): Promise<{ load: LoadObservation[]; routeMs: number[] }> {
  const load: LoadObservation[] = [];
  const routeMs: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const context = await browser.newContext();
    const firstPage = await context.newPage();
    const unexpected = watchRemoteRequests(firstPage, baseURL);
    if (releaseProfile) await setCpuRate(context, firstPage, 4, false);
    await firstPage.goto(practicePath);
    await waitForPractice(firstPage);
    await firstPage.goto("/train");
    await expect(firstPage.getByRole("heading", { name: "选择今天的训练方式" })).toBeVisible();
    await firstPage.evaluate(() => performance.mark("symtype-route-start"));
    await firstPage.getByRole("button", { name: /智能课程/u }).click();
    await waitForPractice(firstPage);
    routeMs.push(
      await firstPage.evaluate(
        () =>
          performance.now() - performance.getEntriesByName("symtype-route-start").at(-1)!.startTime
      )
    );
    const warmPage = await context.newPage();
    const warmUnexpected = watchRemoteRequests(warmPage, baseURL);
    await installLoadProbe(warmPage);
    if (releaseProfile) await setCpuRate(context, warmPage, 4, false);
    await warmPage.goto(practicePath, { waitUntil: "domcontentloaded" });
    await waitForPractice(warmPage);
    load.push(await readLoadObservation(warmPage, warmUnexpected));
    expect([...unexpected, ...warmUnexpected]).toEqual([]);
    await context.close();
  }
  return { load, routeMs };
}

test("records cold, warm, and client-route production load samples", async ({
  browser,
  request,
  baseURL
}, testInfo) => {
  test.skip(testInfo.project.name === "chromium-memory", "The memory project has a separate suite");
  const samples = requiredSamples();
  test.setTimeout(Math.max(240_000, samples * 45_000));
  if (!baseURL) throw new Error("The performance base URL is not configured");
  await patchSettings(request, {
    onboardingComplete: true,
    calibrationComplete: false,
    keyboardVisible: false,
    reducedMotion: true,
    soundEnabled: false,
    theme: "light"
  });
  const releaseProfile = testInfo.project.name === "chromium-release";
  const chromium = testInfo.project.name.startsWith("chromium");
  const cold = await collectColdSamples(browser, baseURL, samples, releaseProfile);
  const warm = await collectWarmSamples(browser, baseURL, samples, releaseProfile);
  if (chromium) {
    expect(cold.every((sample) => sample.fcpMs != null && sample.lcpMs != null)).toBeTruthy();
    expect(warm.load.every((sample) => sample.lcpMs != null)).toBeTruthy();
  }
  await saveObservation(testInfo, "client-load", {
    cache: { cold: "new context with empty HTTP cache", warm: "same-context HTTP cache" },
    browserVersion: browser.version(),
    cpuSlowdown: releaseProfile ? 4 : 1,
    cold,
    engine: chromium ? "chromium" : "webkit",
    project: testInfo.project.name,
    routeMs: warm.routeMs,
    sampleCount: samples,
    warm: warm.load
  });
});
