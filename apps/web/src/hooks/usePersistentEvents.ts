import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { StoredEvent } from "../types";

interface Context {
  lessonId?: string;
  blockId?: string;
}

interface PendingBatch {
  batchId: string;
  events: StoredEvent[];
  context: Context;
}

const MAX_BUFFERED_EVENTS = 500;

export function usePersistentEvents(
  sessionId: string | null,
  getContext: () => Context,
  onError: (message: string) => void,
  initialSequence = 0
) {
  const queueRef = useRef<StoredEvent[]>([]);
  const pendingRef = useRef<PendingBatch[]>([]);
  const sequenceRef = useRef(0);
  const sequenceSessionRef = useRef<string | null>(null);
  const flushPromiseRef = useRef<Promise<void> | null>(null);
  const countRefreshTimerRef = useRef<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      sequenceSessionRef.current = null;
      return;
    }
    if (sequenceSessionRef.current !== sessionId) {
      sequenceSessionRef.current = sessionId;
      sequenceRef.current = Number.isSafeInteger(initialSequence) ? initialSequence : 0;
    } else if (Number.isSafeInteger(initialSequence)) {
      // A checkpoint refresh for the same session may advance, but never rewind,
      // a sequence already claimed by an in-memory event.
      sequenceRef.current = Math.max(sequenceRef.current, initialSequence);
    }
  }, [initialSequence, sessionId]);

  const refreshCount = useCallback((immediate = false) => {
    const commit = () => {
      countRefreshTimerRef.current = null;
      setPendingCount(
        queueRef.current.length +
          pendingRef.current.reduce((sum, batch) => sum + batch.events.length, 0)
      );
    };
    if (immediate) {
      if (countRefreshTimerRef.current != null) {
        window.clearTimeout(countRefreshTimerRef.current);
      }
      commit();
      return;
    }
    // The queue itself lives in refs. Coalesce the status badge update so a
    // keypress never forces the entire page tree to render synchronously.
    if (countRefreshTimerRef.current == null) {
      countRefreshTimerRef.current = window.setTimeout(commit, 250);
    }
  }, []);

  useEffect(
    () => () => {
      if (countRefreshTimerRef.current != null) {
        window.clearTimeout(countRefreshTimerRef.current);
      }
    },
    []
  );

  const sendPending = useCallback(async () => {
    if (!sessionId) return;
    for (;;) {
      if (flushPromiseRef.current) {
        await flushPromiseRef.current;
        continue;
      }
      if (pendingRef.current.length === 0) return;
      const operation = (async () => {
        try {
          while (pendingRef.current.length > 0) {
            const batch = pendingRef.current[0];
            if (!batch) break;
            await api.post(`/api/v1/sessions/${sessionId}/events`, {
              batchId: batch.batchId,
              ...batch.context,
              events: batch.events
            });
            pendingRef.current.shift();
            refreshCount(true);
          }
        } catch (error) {
          refreshCount(true);
          onError(error instanceof Error ? error.message : "逐键记录暂未写入，正在保留并重试。");
          throw error;
        } finally {
          flushPromiseRef.current = null;
        }
      })();
      flushPromiseRef.current = operation;
      await operation;
    }
  }, [onError, refreshCount, sessionId]);

  const flush = useCallback(async () => {
    if (!sessionId) return;
    if (queueRef.current.length > 0) {
      pendingRef.current.push({
        batchId: crypto.randomUUID(),
        events: queueRef.current.splice(0),
        context: getContext()
      });
      refreshCount();
    }
    await sendPending();
  }, [getContext, refreshCount, sendPending, sessionId]);

  const enqueue = useCallback(
    (event: Omit<StoredEvent, "sequence">) => {
      const buffered =
        queueRef.current.length +
        pendingRef.current.reduce((sum, batch) => sum + batch.events.length, 0);
      if (buffered >= MAX_BUFFERED_EVENTS) {
        onError("本机服务器暂时不可用，已暂停输入以保护尚未写入的 500 个事件。请重试保存后继续。");
        refreshCount(true);
        return null;
      }
      const withSequence = { ...event, sequence: sequenceRef.current++ };
      queueRef.current.push(withSequence);
      refreshCount();
      if (queueRef.current.length >= 24) void flush().catch(() => undefined);
      return withSequence.sequence;
    },
    [flush, onError, refreshCount]
  );

  useEffect(() => {
    if (!sessionId) return;
    const interval = window.setInterval(() => void flush().catch(() => undefined), 3000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush().catch(() => undefined);
    };
    const onPageHide = () => {
      if (queueRef.current.length > 0) {
        pendingRef.current.push({
          batchId: crypto.randomUUID(),
          events: queueRef.current.splice(0),
          context: getContext()
        });
      }
      const token = encodeURIComponent(api.getCsrfToken());
      for (const batch of pendingRef.current) {
        const payload = JSON.stringify({
          batchId: batch.batchId,
          ...batch.context,
          events: batch.events
        });
        const endpoint = `/api/v1/sessions/${sessionId}/events/beacon?csrf=${token}`;
        let accepted = false;
        try {
          accepted =
            navigator.sendBeacon?.(endpoint, new Blob([payload], { type: "application/json" })) ??
            false;
        } catch {
          // Some WebKit/privacy configurations expose sendBeacon but reject
          // the payload. The keepalive request below is the last-chance path.
        }
        if (!accepted) {
          void fetch(endpoint, {
            method: "POST",
            body: payload,
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            keepalive: true
          }).catch(() => undefined);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flush, getContext, sessionId]);

  return {
    enqueue,
    flush,
    pendingCount,
    isAtCapacity: pendingCount >= MAX_BUFFERED_EVENTS,
    capacity: MAX_BUFFERED_EVENTS
  };
}
