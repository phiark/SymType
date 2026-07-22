/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type ApiError } from "./api";
import { testBootstrap } from "./test/fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("API protected downloads", () => {
  it("sends the bootstrap CSRF token and preserves the server filename", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(testBootstrap), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response("sqlite bytes", {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.sqlite3",
            "Content-Disposition": 'attachment; filename="symtype-safe.sqlite3"'
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await api.bootstrap();
    const result = await api.download("/api/v1/export/sqlite");

    expect(result.filename).toBe("symtype-safe.sqlite3");
    expect(result.blob.size).toBe("sqlite bytes".length);
    const request = fetchMock.mock.calls[1];
    const headers = new Headers(request?.[1]?.headers);
    expect(request?.[0]).toBe("/api/v1/export/sqlite");
    expect(headers.get("X-SymType-CSRF")).toBe(testBootstrap.csrfToken);
    expect(request?.[1]?.credentials).toBe("same-origin");
  });

  it("turns a protected download failure into a readable API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: "CSRF_FAILED", message: "安全令牌已过期" } }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          )
        )
    );

    await expect(api.download("/api/v1/export/sqlite")).rejects.toEqual(
      expect.objectContaining<ApiError>({
        name: "ApiError",
        status: 403,
        code: "CSRF_FAILED",
        message: "安全令牌已过期"
      })
    );
  });

  it("rejects unregistered downloads and incompatible binary content types", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.download("/api/v1/export/unknown")).rejects.toEqual(
      expect.objectContaining({ code: "CLIENT_CONTRACT_MISMATCH", status: 400 })
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ not: "sqlite" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    await expect(api.download("/api/v1/export/sqlite")).rejects.toEqual(
      expect.objectContaining({ code: "SERVER_CONTRACT_MISMATCH", status: 502 })
    );
  });

  it("rejects a request that violates the shared route contract before fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api.post("/api/v1/sessions", {
        kind: "training",
        mode: "smart",
        seed: -1,
        focus: []
      })
    ).rejects.toEqual(expect.objectContaining({ code: "CLIENT_CONTRACT_MISMATCH", status: 400 }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid registered path and query values before fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/api/v1/sessions/not-a-uuid")).rejects.toEqual(
      expect.objectContaining({ code: "CLIENT_CONTRACT_MISMATCH", status: 400 })
    );
    await expect(api.get("/api/v1/statistics?period=year")).rejects.toEqual(
      expect.objectContaining({ code: "CLIENT_CONTRACT_MISMATCH", status: 400 })
    );
    await expect(api.get("/api/v1/statistics?period=7d&extra=1")).rejects.toEqual(
      expect.objectContaining({ code: "CLIENT_CONTRACT_MISMATCH", status: 400 })
    );
    await expect(api.download("/api/v1/export/sqlite?unexpected=1")).rejects.toEqual(
      expect.objectContaining({ code: "CLIENT_CONTRACT_MISMATCH", status: 400 })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a successful HTTP response that violates the shared route contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ csrfToken: "only-a-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(api.bootstrap()).rejects.toEqual(
      expect.objectContaining({ code: "SERVER_CONTRACT_MISMATCH", status: 502 })
    );
  });

  it("applies secondary route request and response contracts before data reaches the UI", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      api.post("/api/v1/layouts", { name: "", baseLayoutId: "symmetric-default" })
    ).rejects.toEqual(expect.objectContaining({ code: "CLIENT_CONTRACT_MISMATCH", status: 400 }));
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ today: { fabricated: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    await expect(api.get("/api/v1/dashboard")).rejects.toEqual(
      expect.objectContaining({ code: "SERVER_CONTRACT_MISMATCH", status: 502 })
    );
  });

  it("uses binary request metadata for SQLite preview without JSON coercion", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      api.postRaw("/api/v1/import/sqlite/preview", new ArrayBuffer(8), "application/json")
    ).rejects.toEqual(expect.objectContaining({ code: "CLIENT_CONTRACT_MISMATCH", status: 400 }));
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          token: "f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd",
          expiresAt: "2026-07-21T08:00:00.000Z",
          summary: { profiles: 1, sessions: 2, events: 3, customTexts: 0, gameRuns: 0 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    await expect(
      api.postRaw("/api/v1/import/sqlite/preview", new ArrayBuffer(8), "application/vnd.sqlite3")
    ).resolves.toMatchObject({ ok: true, summary: { events: 3 } });
    const request = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get("Content-Type")).toBe("application/vnd.sqlite3");
    expect(request?.body).toBeInstanceOf(ArrayBuffer);
  });

  it("keeps custom-text progress on the evidence-backed block path", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, readingPosition: 40 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const textId = "a7818f7b-0819-43bb-ae60-6cf9c13e671b";
    const blockId = "f30226f4-ed8c-4bc3-89c4-a2ad55aa9ddd";

    await expect(
      api.patch(`/api/v1/custom-texts/${textId}/progress`, { readingPosition: 40 })
    ).rejects.toEqual(expect.objectContaining({ code: "CLIENT_CONTRACT_MISMATCH", status: 400 }));
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      api.patch<{ ok: true; readingPosition: number }>(`/api/v1/custom-texts/${textId}/progress`, {
        blockId,
        readingPosition: 40
      })
    ).resolves.toEqual({ ok: true, readingPosition: 40 });
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body");
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    expect(body).toEqual({ blockId, readingPosition: 40 });
  });
});
