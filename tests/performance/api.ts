import { expect, type APIRequestContext } from "@playwright/test";

export async function patchSettings(
  request: APIRequestContext,
  settings: Record<string, unknown>
): Promise<void> {
  const bootstrap = await request.get("/api/v1/bootstrap");
  expect(bootstrap.ok(), await bootstrap.text()).toBeTruthy();
  const token = ((await bootstrap.json()) as { csrfToken: string }).csrfToken;
  const response = await request.patch("/api/v1/settings", {
    data: settings,
    headers: { "X-SymType-CSRF": token }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function createCustomText(
  request: APIRequestContext,
  content: string
): Promise<string> {
  const bootstrap = await request.get("/api/v1/bootstrap");
  expect(bootstrap.ok(), await bootstrap.text()).toBeTruthy();
  const token = ((await bootstrap.json()) as { csrfToken: string }).csrfToken;
  const response = await request.post("/api/v1/custom-texts", {
    data: {
      title: "P3 deterministic mixed input",
      content,
      fileType: "txt",
      includeInModel: false
    },
    headers: { "X-SymType-CSRF": token }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { text: { id: string } }).text.id;
}

export async function exportDatabase(request: APIRequestContext): Promise<{
  data: {
    keystroke_events: Array<Record<string, unknown>>;
    sessions: Array<Record<string, unknown>>;
  };
}> {
  const response = await request.get("/api/v1/export/json");
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as {
    data: {
      keystroke_events: Array<Record<string, unknown>>;
      sessions: Array<Record<string, unknown>>;
    };
  };
}
