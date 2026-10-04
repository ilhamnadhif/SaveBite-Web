"use client";

import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { navigator, type NavEntry, type PopGuard } from "../lib/navigator";

type EntryContextValue = { key: string; isTop: boolean };

const EntryContext = createContext<EntryContextValue>({ key: "", isTop: true });

/** The navigator entry the calling screen belongs to. */
export function useNavEntry(): EntryContextValue {
  return useContext(EntryContext);
}

/** True while the calling screen is the visible (top) route. */
export function useIsTopRoute(): boolean {
  return useContext(EntryContext).isTop;
}

/**
 * Flutter `PopScope(canPop: …, onPopInvokedWithResult: …)`.
 *
 * `guard` returns `true` to block the pop; it runs for the in-app back
 * button (`navigator.maybePop`) and for the browser back button.
 */
export function usePopGuard(guard: PopGuard | null) {
  const { key } = useNavEntry();
  const ref = useRef(guard);
  ref.current = guard;
  const enabled = guard !== null;
  useEffect(() => {
    if (!key || !enabled) return;
    navigator.setGuard(key, () => ref.current?.() ?? false);
    return () => navigator.setGuard(key, undefined);
  }, [key, enabled]);
}

function useStack(): readonly NavEntry[] {
  return useSyncExternalStore(navigator.subscribe, navigator.getSnapshot, navigator.getSnapshot);
}

/**
 * Renders the navigator stack. Every entry stays mounted; only the top one
 * is visible and interactive (the rest are `inert`).
 */
export function NavigatorView() {
  const stack = useStack();
  const topIndex = stack.length - 1;
  return (
    <>
      {stack.map((entry, index) => {
        const isTop = index === topIndex;
        return (
          <div
            key={entry.key}
            className="sb-layer"
            data-hidden={isTop ? undefined : "true"}
            // Set from mount so the enter animation plays once; revealing an
            // entry again after a pop must not replay it.
            data-enter={entry.transition !== "none" ? entry.transition : undefined}
            aria-hidden={isTop ? undefined : true}
            inert={!isTop}
          >
            <EntryContext.Provider value={{ key: entry.key, isTop }}>{entry.element}</EntryContext.Provider>
          </div>
        );
      })}
    </>
  );
}
