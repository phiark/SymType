import { useCallback, useEffect, useRef } from "react";

import { registerDesktopLifecycleHandler, type DesktopLifecycleResult } from "../desktop-lifecycle";

interface DesktopSessionLifecycleOptions {
  active: boolean;
  isCriticalMutationInFlight: () => boolean;
  flush: () => Promise<void>;
  pause: () => void;
  requestExitConfirmation: () => void;
  onError: (message: string) => void;
}

interface PendingQuitRequest {
  promise: Promise<DesktopLifecycleResult>;
  resolve: (result: DesktopLifecycleResult) => void;
}

const DESKTOP_PERSISTENCE_TIMEOUT_MS = 10_000;

class DesktopPersistenceTimeoutError extends Error {
  constructor() {
    super("保存等待超过 10 秒；尚未确认写入的数据仍保留在当前页面。");
    this.name = "DesktopPersistenceTimeoutError";
  }
}

function withDesktopPersistenceDeadline<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new DesktopPersistenceTimeoutError());
    }, DESKTOP_PERSISTENCE_TIMEOUT_MS);
    operation.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error("保存请求未能完成。"));
      }
    );
  });
}

export function useDesktopSessionLifecycle({
  active,
  isCriticalMutationInFlight,
  flush,
  pause,
  requestExitConfirmation,
  onError
}: DesktopSessionLifecycleOptions) {
  const activeRef = useRef(active);
  const isCriticalMutationInFlightRef = useRef(isCriticalMutationInFlight);
  const flushRef = useRef(flush);
  const pauseRef = useRef(pause);
  const requestExitConfirmationRef = useRef(requestExitConfirmation);
  const onErrorRef = useRef(onError);
  const pendingQuitRef = useRef<PendingQuitRequest | null>(null);

  useEffect(() => {
    activeRef.current = active;
    isCriticalMutationInFlightRef.current = isCriticalMutationInFlight;
    flushRef.current = flush;
    pauseRef.current = pause;
    requestExitConfirmationRef.current = requestExitConfirmation;
    onErrorRef.current = onError;
  }, [active, flush, isCriticalMutationInFlight, onError, pause, requestExitConfirmation]);

  const completeDesktopQuitRequest = useCallback((result: DesktopLifecycleResult) => {
    const pending = pendingQuitRef.current;
    if (!pending) return;
    pendingQuitRef.current = null;
    pending.resolve(result);
  }, []);

  const runDesktopQuitPersistence = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      // Browser navigation keeps its existing persistence semantics. The deadline is introduced
      // only while native Cmd-Q is waiting, after the user has explicitly chosen to save/exit.
      if (!pendingQuitRef.current) return operation();
      try {
        return await withDesktopPersistenceDeadline(operation());
      } catch (error) {
        if (error instanceof DesktopPersistenceTimeoutError) {
          onErrorRef.current(error.message);
          completeDesktopQuitRequest("failed");
        }
        throw error;
      }
    },
    [completeDesktopQuitRequest]
  );

  useEffect(() => {
    const persistPendingEvents = async (): Promise<DesktopLifecycleResult> => {
      try {
        await withDesktopPersistenceDeadline(flushRef.current());
        return "ready";
      } catch (error) {
        onErrorRef.current(
          error instanceof Error ? error.message : "无法把尚未保存的按键写入本机数据库。"
        );
        return "failed";
      }
    };

    return registerDesktopLifecycleHandler({
      prepareToHide: async () => {
        if (isCriticalMutationInFlightRef.current()) return "failed";
        if (activeRef.current) pauseRef.current();
        return persistPendingEvents();
      },
      requestQuit: () => {
        if (isCriticalMutationInFlightRef.current()) return "failed";
        if (!activeRef.current) return persistPendingEvents();
        pauseRef.current();
        const pending = pendingQuitRef.current;
        if (pending) return pending.promise;

        let resolve!: (result: DesktopLifecycleResult) => void;
        const promise = new Promise<DesktopLifecycleResult>((resolvePromise) => {
          resolve = resolvePromise;
        });
        pendingQuitRef.current = { promise, resolve };
        requestExitConfirmationRef.current();
        return promise;
      }
    });
  }, []);

  useEffect(
    () => () => {
      completeDesktopQuitRequest("cancelled");
    },
    [completeDesktopQuitRequest]
  );

  return { completeDesktopQuitRequest, runDesktopQuitPersistence };
}
