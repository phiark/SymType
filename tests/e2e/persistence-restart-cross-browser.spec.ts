import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  chromium,
  expect,
  test,
  webkit,
  type APIRequestContext,
  type Page
} from "@playwright/test";

import { finishOnboarding, typeTargetAtPace } from "./helpers";

interface ServerInfo {
  url: string;
  pid: number;
  startedAt: string;
  databasePath: string;
}

interface ManagedServer {
  child: ChildProcessWithoutNullStreams;
  info: ServerInfo;
  output: () => { stderr: string; stdout: string };
}

interface ExportedHistory {
  data: {
    sessions: Array<{ id: string; status: string }>;
    keystroke_events: Array<{
      session_id: string;
      sequence: number;
      target_char: string;
      actual_char: string;
    }>;
  };
}

interface PersistenceSnapshot {
  dataLocation: string;
  dashboard: { sessions: number; characters: number };
  statistics: { sessions: number; characters: number; correct: number; errors: number };
  sessionStatus: string;
  events: Array<{
    sequence: number;
    target: string;
    actual: string;
  }>;
}

function appendBounded(current: string, chunk: Buffer): string {
  const combined = `${current}${chunk.toString()}`;
  return combined.length > 80_000 ? combined.slice(-80_000) : combined;
}

async function availableLoopbackPort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    reservation.once("error", rejectPromise);
    reservation.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") {
    reservation.close();
    throw new Error("Could not allocate an isolated loopback port");
  }
  await new Promise<void>((resolvePromise, rejectPromise) => {
    reservation.close((error) => (error ? rejectPromise(error) : resolvePromise()));
  });
  return address.port;
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
  if (child.exitCode !== null) return child.exitCode;
  return Promise.race([
    new Promise<number | null>((resolvePromise) =>
      child.once("exit", (code) => resolvePromise(code))
    ),
    delay(timeoutMs).then(() => {
      throw new Error(`Server process ${String(child.pid)} did not exit within ${timeoutMs}ms`);
    })
  ]);
}

async function waitForReady(
  child: ChildProcessWithoutNullStreams,
  dataDirectory: string,
  output: () => { stderr: string; stdout: string }
): Promise<ServerInfo> {
  const infoPath = join(dataDirectory, "server-info.json");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const captured = output();
      throw new Error(
        `Production server exited before readiness (${String(child.exitCode)}):\n${captured.stdout}\n${captured.stderr}`
      );
    }
    if (existsSync(infoPath)) {
      try {
        const info = JSON.parse(readFileSync(infoPath, "utf8")) as ServerInfo;
        if (info.pid === child.pid) {
          const response = await fetch(new URL("/api/v1/health", info.url), {
            cache: "no-store",
            signal: AbortSignal.timeout(1_500)
          });
          const body = (await response.json()) as { ok?: boolean; integrity?: { ok?: boolean } };
          if (response.ok && body.ok === true && body.integrity?.ok === true) return info;
        }
      } catch {
        // Readiness requires matching process metadata and a successful integrity-aware health call.
      }
    }
    await delay(100);
  }
  const captured = output();
  throw new Error(
    `Production server did not become healthy:\n${captured.stdout}\n${captured.stderr}`
  );
}

async function launchServer(dataDirectory: string, port: number): Promise<ManagedServer> {
  mkdirSync(dataDirectory, { recursive: true });
  const child = spawn(process.execPath, [resolve("apps/server/dist/index.js")], {
    cwd: resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      SYMTYPE_DATA_DIR: dataDirectory,
      SYMTYPE_HOST: "127.0.0.1",
      SYMTYPE_PORT: String(port),
      SYMTYPE_WEB_DIST: resolve("apps/web/dist")
    },
    stdio: "pipe"
  });
  child.stdin.end();
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk);
  });
  const output = () => ({ stderr, stdout });
  const info = await waitForReady(child, dataDirectory, output);
  return { child, info, output };
}

async function stopServer(server: ManagedServer, label: string): Promise<void> {
  if (server.child.exitCode === null) server.child.kill("SIGTERM");
  const code = await waitForExit(server.child, 15_000);
  expect(code, `${label} did not shut down cleanly:\n${server.output().stderr}`).toBe(0);
}

async function completeRealTraining(page: Page): Promise<{
  sessionId: string;
  characters: number;
  correct: number;
  errors: number;
}> {
  await finishOnboarding(page);
  await page.clock.install();
  await page.goto(
    "/train/session?mode=smart&duration=0.25&focus=ct&scope=%E9%A3%9F%E6%8C%87%E5%8C%BA&seed=73021"
  );
  const sessionResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/sessions") && response.request().method() === "POST"
  );
  const firstBlockPromise = page.waitForResponse(
    (response) => response.url().includes("/blocks/next") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /^开始$/u }).click();
  const sessionResponse = await sessionResponsePromise;
  expect(sessionResponse.ok(), await sessionResponse.text()).toBeTruthy();
  const sessionId = ((await sessionResponse.json()) as { session: { id: string } }).session.id;
  let blockResponse = await firstBlockPromise;
  let completion: { summary: { characters: number; correct: number; errors: number } } | undefined;

  for (let blockNumber = 0; blockNumber < 8 && !completion; blockNumber += 1) {
    expect(blockResponse.ok(), await blockResponse.text()).toBeTruthy();
    const block = (await blockResponse.json()) as { block: { target_text: string } };
    expect(block.block.target_text.length).toBeGreaterThan(0);
    const transitionPromise = page.waitForResponse((response) => {
      if (response.request().method() !== "POST") return false;
      return (
        response.url().includes("/blocks/next") ||
        response.url().endsWith(`/api/v1/sessions/${sessionId}/complete`)
      );
    });
    await typeTargetAtPace(page, block.block.target_text, 50);
    const transition = await transitionPromise;
    expect(transition.ok(), await transition.text()).toBeTruthy();
    if (transition.url().endsWith(`/api/v1/sessions/${sessionId}/complete`)) {
      completion = (await transition.json()) as typeof completion;
    } else {
      blockResponse = transition;
    }
  }

  expect(
    completion,
    "The real Chromium training flow did not reach persisted completion"
  ).toBeDefined();
  expect(completion?.summary.characters).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "这一轮完成了" })).toBeVisible();
  await expect(page.getByText(/已安全保存到这台电脑/u)).toBeVisible();
  return {
    sessionId,
    characters: completion?.summary.characters ?? 0,
    correct: completion?.summary.correct ?? 0,
    errors: completion?.summary.errors ?? 0
  };
}

async function readSnapshot(
  request: APIRequestContext,
  sessionId: string
): Promise<PersistenceSnapshot> {
  const [bootstrapResponse, dashboardResponse, statisticsResponse, exportResponse] =
    await Promise.all([
      request.get("/api/v1/bootstrap"),
      request.get("/api/v1/dashboard"),
      request.get("/api/v1/statistics?period=all"),
      request.get("/api/v1/export/json")
    ]);
  for (const response of [
    bootstrapResponse,
    dashboardResponse,
    statisticsResponse,
    exportResponse
  ]) {
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const bootstrap = (await bootstrapResponse.json()) as { dataLocation: string };
  const dashboard = (await dashboardResponse.json()) as {
    today: { sessions: number; characters: number };
  };
  const statistics = (await statisticsResponse.json()) as {
    overview: {
      sessions: number;
      characters: number;
      correct: number;
      errors: number;
    };
  };
  const exported = (await exportResponse.json()) as ExportedHistory;
  const session = exported.data.sessions.find((candidate) => candidate.id === sessionId);
  const events = exported.data.keystroke_events
    .filter((event) => event.session_id === sessionId)
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => ({
      sequence: event.sequence,
      target: event.target_char,
      actual: event.actual_char
    }));
  return {
    dataLocation: bootstrap.dataLocation,
    dashboard: dashboard.today,
    statistics: statistics.overview,
    sessionStatus: session?.status ?? "missing",
    events
  };
}

test("one SQLite history survives service restart and a fresh WebKit browser reads it", async ({
  browserName
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "The Chromium project owns this cross-engine service-lifecycle acceptance exactly once."
  );
  test.setTimeout(180_000);

  const fixtureRoot = mkdtempSync(join(tmpdir(), "symtype-restart-cross-browser-"));
  const dataDirectory = join(fixtureRoot, "data");
  const databasePath = join(dataDirectory, "symtype.sqlite3");
  const safeFixturePrefix = join(tmpdir(), "symtype-restart-cross-browser-");
  expect(`${fixtureRoot}${sep}`.startsWith(safeFixturePrefix)).toBeTruthy();
  expect(basename(fixtureRoot)).toMatch(/^symtype-restart-cross-browser-/u);

  const port = await availableLoopbackPort();
  let server: ManagedServer | undefined;
  let chromiumBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let webkitBrowser: Awaited<ReturnType<typeof webkit.launch>> | undefined;
  let completed = false;
  let evidence: Record<string, unknown> = { dataDirectory, databasePath, port };

  try {
    server = await launchServer(dataDirectory, port);
    expect(server.info.databasePath).toBe(databasePath);
    const firstServerInfo = server.info;

    chromiumBrowser = await chromium.launch({ headless: true });
    const chromiumContext = await chromiumBrowser.newContext({ baseURL: firstServerInfo.url });
    const chromiumPage = await chromiumContext.newPage();
    const training = await completeRealTraining(chromiumPage);
    const beforeRestart = await readSnapshot(chromiumContext.request, training.sessionId);
    expect(beforeRestart).toMatchObject({
      dataLocation: databasePath,
      dashboard: { sessions: 1, characters: training.characters },
      statistics: {
        sessions: 1,
        characters: training.characters,
        correct: training.correct,
        errors: training.errors
      },
      sessionStatus: "completed"
    });
    expect(beforeRestart.events).toHaveLength(training.characters);
    expect(beforeRestart.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: training.characters }, (_, index) => index)
    );
    expect(existsSync(databasePath)).toBeTruthy();
    const databaseBytesBeforeRestart = statSync(databasePath).size;
    expect(databaseBytesBeforeRestart).toBeGreaterThan(0);

    await chromiumContext.close();
    await chromiumBrowser.close();
    chromiumBrowser = undefined;
    await stopServer(server, "First production service");
    server = undefined;

    server = await launchServer(dataDirectory, port);
    const restartedServerInfo = server.info;
    expect(restartedServerInfo.databasePath).toBe(databasePath);
    expect(restartedServerInfo.pid).not.toBe(firstServerInfo.pid);
    expect(restartedServerInfo.startedAt).not.toBe(firstServerInfo.startedAt);

    webkitBrowser = await webkit.launch({ headless: true });
    const webkitContext = await webkitBrowser.newContext({ baseURL: restartedServerInfo.url });
    expect(await webkitContext.cookies()).toEqual([]);
    const webkitPage = await webkitContext.newPage();
    await webkitPage.goto("/");
    await webkitPage.waitForLoadState("networkidle");
    expect(
      await webkitPage.evaluate(() => ({
        localStorageEntries: localStorage.length,
        sessionStorageEntries: sessionStorage.length
      }))
    ).toEqual({ localStorageEntries: 0, sessionStorageEntries: 0 });

    const todayCard = webkitPage.locator(".metric-card").filter({
      has: webkitPage.getByText("今天练习", { exact: true })
    });
    await expect(todayCard).toContainText(`1 节 · ${training.characters} 字符`);

    await webkitPage.goto("/analytics");
    await webkitPage.waitForLoadState("networkidle");
    const allStatistics = webkitPage.waitForResponse((response) =>
      response.url().endsWith("/api/v1/statistics?period=all")
    );
    await webkitPage.getByRole("button", { name: "全部", exact: true }).click();
    expect((await allStatistics).ok()).toBeTruthy();
    const effectivePracticeCard = webkitPage.locator(".metric-card").filter({
      has: webkitPage.getByText("有效练习", { exact: true })
    });
    const characterCard = webkitPage.locator(".metric-card").filter({
      has: webkitPage.getByText("字符", { exact: true })
    });
    await expect(effectivePracticeCard).toContainText("1 节");
    await expect(characterCard.locator("strong")).toHaveText(training.characters.toLocaleString());

    const afterRestart = await readSnapshot(webkitContext.request, training.sessionId);
    expect(afterRestart).toEqual(beforeRestart);
    expect(statSync(databasePath).size).toBeGreaterThan(0);

    evidence = {
      databasePath,
      databaseBytesBeforeRestart,
      sessionId: training.sessionId,
      characters: training.characters,
      correct: training.correct,
      errors: training.errors,
      sessions: beforeRestart.statistics.sessions,
      firstService: {
        pid: firstServerInfo.pid,
        startedAt: firstServerInfo.startedAt,
        url: firstServerInfo.url
      },
      restartedService: {
        pid: restartedServerInfo.pid,
        startedAt: restartedServerInfo.startedAt,
        url: restartedServerInfo.url
      },
      writerBrowser: "Chromium (fresh process/context)",
      readerBrowser: "WebKit (fresh process/context, zero browser-storage entries)",
      beforeRestart,
      afterRestart
    };
    await testInfo.attach("restart-cross-browser-evidence.json", {
      body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
      contentType: "application/json"
    });
    console.log(
      `[restart-cross-browser] session=${training.sessionId} sessions=1 characters=${training.characters} database=${databasePath}`
    );

    await webkitContext.close();
    await webkitBrowser.close();
    webkitBrowser = undefined;
    await stopServer(server, "Restarted production service");
    server = undefined;
    completed = true;
  } finally {
    await chromiumBrowser?.close().catch(() => undefined);
    await webkitBrowser?.close().catch(() => undefined);
    if (server) await stopServer(server, "Restarted production service").catch(() => undefined);
    if (!completed) {
      await testInfo.attach("restart-cross-browser-failure-context.json", {
        body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
        contentType: "application/json"
      });
    } else if (
      `${fixtureRoot}${sep}`.startsWith(safeFixturePrefix) &&
      basename(fixtureRoot).startsWith("symtype-restart-cross-browser-")
    ) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});
