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

  useEffect(() => {
    const persistPendingEvents = async (): Promise<DesktopLifecycleResult> => {
      try {
        await flushRef.current();
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

  return { completeDesktopQuitRequest };
}
