import { useCallback, useEffect, useRef } from "react";
import { useBeforeUnload, useBlocker, useLocation, type BlockerFunction } from "react-router-dom";

/**
 * Blocks same-app navigation while a server session is active and asks the
 * browser for confirmation before a hard unload. The caller owns the visible
 * confirmation and must flush/abandon before calling blocker.proceed().
 */
export function useSessionNavigationGuard(active: boolean) {
  const location = useLocation();
  const bypassRef = useRef(false);
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      active &&
      !bypassRef.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
    [active]
  );
  const blocker = useBlocker(shouldBlock);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!active) return;
        event.preventDefault();
        event.returnValue = "";
      },
      [active]
    )
  );

  useEffect(() => {
    bypassRef.current = false;
  }, [location.key]);

  useEffect(() => {
    if (!active && blocker.state === "blocked") blocker.proceed();
  }, [active, blocker]);

  const bypassNextNavigation = useCallback(() => {
    bypassRef.current = true;
    // React Router reads the blocker synchronously. Reset in case the caller
    // decides not to navigate after requesting a one-shot bypass.
    window.setTimeout(() => {
      bypassRef.current = false;
    }, 0);
  }, []);

  return { blocker, bypassNextNavigation };
}
