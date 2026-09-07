/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredEvent } from "../types";
import { usePersistentEvents } from "./usePersistentEvents";

const apiMocks = vi.hoisted(() => ({
  post: vi.fn(),
  getCsrfToken: vi.fn(() => "csrf token/+?")
}));

vi.mock("../api", () => ({
  api: apiMocks
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Blob did not decode as text"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Blob read failed")));
    reader.readAsText(blob);
  });
}

function event(targetChar: string): Omit<StoredEvent, "sequence"> {
  return {
    clientTimeMs: 100,
    targetChar,
    actualChar: targetChar,
    physicalCode: `Key${targetChar.toUpperCase()}`,
    shiftSide: "none",
    modifiers: {},
    isCorrect: true,
    isCorrection: false,
    backspaceCount: 0,
    ikiMs: 120,
    featureChar: targetChar,
    bigram: null,
    trigram: null,
    mappedHand: "left",
    mappedFinger: "left-index",
    keyboardRow: "home",
    zone: "index",
    characterClass: "letter",
    contentMode: "smart",
    textPosition: 0,
    isWordBoundary: false,
    isAfterError: false,
    wasRefocus: false,
    wasPaused: false,
    wasLongPause: false,
    wasThrottled: false,
    wasRepeat: false
  };
}

beforeEach(() => {
  apiMocks.post.mockReset();
  apiMocks.getCsrfToken.mockReset();
  apiMocks.getCsrfToken.mockReturnValue("csrf token/+?");
  vi.spyOn(globalThis.crypto, "randomUUID")
    .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
    .mockReturnValueOnce("00000000-0000-4000-8000-000000000002")
    .mockReturnValue("00000000-0000-4000-8000-000000000003");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("usePersistentEvents", () => {
  it("does not let a just-finished empty flush strand a newly queued completion batch", async () => {
    apiMocks.post.mockResolvedValue({ accepted: 1 });
    const { result } = renderHook(() =>
      usePersistentEvents(
        "session-1",
        () => ({ lessonId: "lesson-1", blockId: "block-1" }),
        vi.fn()
      )
    );

    let emptyFlush!: Promise<void>;
    let completionFlush!: Promise<void>;
    act(() => {
      emptyFlush = result.current.flush();
      result.current.enqueue(event("a"));
      completionFlush = result.current.flush();
    });
    await act(async () => Promise.all([emptyFlush, completionFlush]));

    expect(apiMocks.post).toHaveBeenCalledTimes(1);
    expect(apiMocks.post.mock.calls[0]?.[1]).toMatchObject({
      events: [expect.objectContaining({ targetChar: "a", sequence: 0 })]
    });
    expect(result.current.pendingCount).toBe(0);
  });

  it("serializes concurrent flushes without posting a batch twice", async () => {
    const firstRequest = deferred<unknown>();
    apiMocks.post
      .mockImplementationOnce(() => firstRequest.promise)
      .mockResolvedValue({ accepted: 1 });
    const onError = vi.fn();
    const { result } = renderHook(() =>
      usePersistentEvents(
        "session-1",
        () => ({ lessonId: "lesson-1", blockId: "block-1" }),
        onError
      )
    );

    act(() => {
      result.current.enqueue(event("a"));
    });
    let firstFlush!: Promise<void>;
    act(() => {
      firstFlush = result.current.flush();
    });
    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.enqueue(event("b"));
    });
    let concurrentFlush!: Promise<void>;
    act(() => {
      concurrentFlush = result.current.flush();
    });
    expect(apiMocks.post).toHaveBeenCalledTimes(1);

    firstRequest.resolve({ accepted: 1 });
    await act(async () => Promise.all([firstFlush, concurrentFlush]));

    expect(apiMocks.post).toHaveBeenCalledTimes(2);
    const firstBody = apiMocks.post.mock.calls[0]?.[1] as {
      batchId: string;
      events: StoredEvent[];
    };
    const secondBody = apiMocks.post.mock.calls[1]?.[1] as {
      batchId: string;
      events: StoredEvent[];
    };
    expect(firstBody.batchId).not.toBe(secondBody.batchId);
    expect(firstBody.events.map((item) => item.sequence)).toEqual([0]);
    expect(secondBody.events.map((item) => item.sequence)).toEqual([1]);
    expect(result.current.pendingCount).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("rejects an explicit failed flush, retains the queue, and retries the same idempotency key", async () => {
    const failure = new Error("network unavailable");
    apiMocks.post.mockRejectedValueOnce(failure).mockResolvedValueOnce({ accepted: 1 });
    const onError = vi.fn();
    const { result } = renderHook(() => usePersistentEvents("session-1", () => ({}), onError));

    act(() => {
      result.current.enqueue(event("c"));
    });
    await act(async () => {
      await expect(result.current.flush()).rejects.toBe(failure);
    });

    expect(result.current.pendingCount).toBe(1);
    expect(onError).toHaveBeenCalledWith(
      "本次更改尚未保存。已保存的数据未受影响。请保留当前页面并重试。 尚未保存的按键仍保留在当前页面；重试会复用同一批次。"
    );
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining("network unavailable"));
    const failedBody = apiMocks.post.mock.calls[0]?.[1] as {
      batchId: string;
      events: StoredEvent[];
    };

    await act(async () => result.current.flush());

    const retriedBody = apiMocks.post.mock.calls[1]?.[1] as {
      batchId: string;
      events: StoredEvent[];
    };
    expect(retriedBody.batchId).toBe(failedBody.batchId);
    expect(retriedBody.events).toEqual(failedBody.events);
    expect(result.current.pendingCount).toBe(0);
  });

  it("beacons queued events on pagehide with a stable batch and encoded CSRF token", async () => {
    const sendBeacon = vi.fn<(url: string, data?: BodyInit | null) => boolean>(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeacon });
    const fetchFallback = vi.fn();
    vi.stubGlobal("fetch", fetchFallback);
    const { result } = renderHook(() =>
      usePersistentEvents("session-1", () => ({ blockId: "block-7" }), vi.fn())
    );

    act(() => {
      result.current.enqueue(event("d"));
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const beaconCall = sendBeacon.mock.calls[0];
    expect(beaconCall?.[0]).toBe(
      "/api/v1/sessions/session-1/events/beacon?csrf=csrf%20token%2F%2B%3F"
    );
    const body = beaconCall?.[1];
    expect(body).toBeInstanceOf(Blob);
    const payload = JSON.parse(await readBlob(body as unknown as Blob)) as {
      batchId: string;
      blockId: string;
      events: StoredEvent[];
    };
    expect(payload).toMatchObject({
      batchId: "00000000-0000-4000-8000-000000000001",
      blockId: "block-7"
    });
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]?.sequence).toBe(0);
    expect(fetchFallback).not.toHaveBeenCalled();
  });

  it("uses a keepalive request when sendBeacon declines the pagehide payload", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => false)
    });
    const fetchFallback = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchFallback);
    const { result } = renderHook(() =>
      usePersistentEvents("session-2", () => ({ lessonId: "lesson-2" }), vi.fn())
    );

    act(() => {
      result.current.enqueue(event("e"));
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(fetchFallback).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchFallback.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("/api/v1/sessions/session-2/events/beacon?csrf=csrf%20token%2F%2B%3F");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" }
    });
    const payload = JSON.parse(init.body as string) as { batchId: string; events: StoredEvent[] };
    expect(payload.batchId).toBe("00000000-0000-4000-8000-000000000001");
    expect(payload.events[0]?.targetChar).toBe("e");
  });

  it("never rewinds one session and resets a new session to its own checkpoint", () => {
    const onError = vi.fn();
    const { result, rerender } = renderHook(
      ({ sessionId, initialSequence }: { sessionId: string; initialSequence: number }) =>
        usePersistentEvents(sessionId, () => ({}), onError, initialSequence),
      { initialProps: { sessionId: "session-1", initialSequence: 8 } }
    );

    let sequence: number | null = -1;
    act(() => {
      sequence = result.current.enqueue(event("f"));
    });
    expect(sequence).toBe(8);

    rerender({ sessionId: "session-1", initialSequence: 3 });
    act(() => {
      sequence = result.current.enqueue(event("g"));
    });
    expect(sequence).toBe(9);

    rerender({ sessionId: "session-2", initialSequence: 20 });
    act(() => {
      sequence = result.current.enqueue(event("h"));
    });
    expect(sequence).toBe(20);

    rerender({ sessionId: "session-3", initialSequence: 0 });
    act(() => {
      sequence = result.current.enqueue(event("i"));
    });
    expect(sequence).toBe(0);
  });

  it("rejects the 501st event synchronously without consuming its sequence", () => {
    apiMocks.post.mockImplementation(() => new Promise(() => undefined));
    const onError = vi.fn();
    const { result } = renderHook(() => usePersistentEvents("session-1", () => ({}), onError));
    let lastAccepted: number | null = null;
    let rejected: number | null = 0;

    act(() => {
      for (let index = 0; index < 500; index += 1) {
        lastAccepted = result.current.enqueue(event("a"));
      }
      rejected = result.current.enqueue(event("b"));
    });

    expect(lastAccepted).toBe(499);
    expect(rejected).toBeNull();
    expect(result.current.pendingCount).toBe(500);
    expect(result.current.isAtCapacity).toBe(true);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("已暂停输入"));
  });

  it("coalesces the parent-facing pending counter instead of updating on every key", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      usePersistentEvents("session-1", () => ({ blockId: "block-1" }), onError)
    );

    act(() => {
      for (let index = 0; index < 10; index += 1) result.current.enqueue(event("a"));
    });
    expect(result.current.pendingCount).toBe(0);

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current.pendingCount).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.pendingCount).toBe(10);
    expect(onError).not.toHaveBeenCalled();
  });
});
