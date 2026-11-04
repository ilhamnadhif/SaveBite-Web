"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { navigator } from "../lib/navigator";
import { useNavEntry } from "../ui/NavigatorView";
import { AppBottomNav, type NavItem } from "../ui/bottomNav";
import { setSnackAboveNav } from "../ui/overlays";
import { C } from "../ui/theme";

/**
 * Shared shell mechanics for the consumer and merchant workspaces: an
 * `IndexedStack` of tabs (each mounted on first visit and then kept alive)
 * plus the bottom navigation. Leaving the home tab adds one browser history
 * entry so back returns home first (`PopScope(canPop: index == 0)`), and the
 * shell refreshes its data when the page becomes visible after 30 s, like
 * `didChangeAppLifecycleState(resumed)`.
 */
export function ShellFrame({
  index,
  setIndex,
  tabs,
  items,
  activeColor,
  tabUrl,
  onSelect,
  reloadAll,
  sidebar,
}: {
  index: number;
  setIndex: (index: number) => void;
  tabs: (index: number) => ReactNode;
  items: readonly NavItem[];
  activeColor: string;
  tabUrl: (index: number) => string;
  /** Per-tab refresh when a tab is selected (`_select`). */
  onSelect: (index: number) => void;
  /** Full refresh on open and when the app resumes (`_reloadAll`). */
  reloadAll: () => Promise<unknown>;
  /** Replaces the bottom navigation in the wide Admin workspace. */
  sidebar?: (select: (index: number) => void) => ReactNode;
}) {
  const { key, isTop } = useNavEntry();
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([index]));
  const lastRefresh = useRef<number | null>(null);
  const reloadRef = useRef(reloadAll);
  reloadRef.current = reloadAll;
  const indexRef = useRef(index);
  indexRef.current = index;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    setMounted((current) => (current.has(index) ? current : new Set([...current, index])));
  }, [index]);

  // Initial load (`addPostFrameCallback(_reloadAll)`).
  useEffect(() => {
    lastRefresh.current = Date.now();
    void reloadRef.current();
  }, []);

  // App resume → refresh when at least 30 s passed since the last refresh.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const last = lastRefresh.current;
      if (last === null || Date.now() - last >= 30_000) {
        lastRefresh.current = Date.now();
        void reloadRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Browser back from a non-home tab lands on the home tab.
  useEffect(() => {
    navigator.setTabListener(key, (tab) => {
      if (indexRef.current !== tab) setIndex(tab);
      onSelectRef.current(tab);
    });
    return () => navigator.setTabListener(key, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Opened on a non-home tab (deep link / notification): put home beneath.
  useEffect(() => {
    if (isTop && indexRef.current !== 0) void navigator.ensureHomeBeneath(key, indexRef.current, tabUrl(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTop, key]);

  // Snack bars float above the bottom navigation while the shell is visible.
  useEffect(() => {
    if (!isTop) return;
    setSnackAboveNav(true);
    return () => setSnackAboveNav(false);
  }, [isTop]);

  const select = (next: number) => {
    if (next < 0 || next >= items.length) return;
    if (next !== index) {
      setIndex(next);
      void navigator.setTab(key, next, tabUrl(next));
    }
    onSelect(next);
  };

  return (
    <div
      className={sidebar ? "sb-admin-layout" : undefined}
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: sidebar ? undefined : "column", background: C.cream }}
    >
      {sidebar?.(select)}
      <div style={{ position: "relative", flex: 1, minHeight: 0, minWidth: 0 }}>
        {items.map((item, tabIndex) =>
          mounted.has(tabIndex) || tabIndex === index ? (
            <div
              key={item.label}
              role="tabpanel"
              aria-label={item.label}
              aria-hidden={tabIndex === index ? undefined : true}
              inert={tabIndex !== index}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                visibility: tabIndex === index ? "visible" : "hidden",
              }}
            >
              <ShellTabContext tab={tabIndex} select={select}>
                {tabs(tabIndex)}
              </ShellTabContext>
            </div>
          ) : null,
        )}
      </div>
      {sidebar ? null : <AppBottomNav items={items} currentIndex={index} onTap={select} activeColor={activeColor} />}
    </div>
  );
}

type ShellScope = { selectTab: (index: number) => void; tab: number };

const ShellContext = createContext<ShellScope | null>(null);

function ShellTabContext({ tab, select, children }: { tab: number; select: (index: number) => void; children: ReactNode }) {
  return <ShellContext.Provider value={{ selectTab: select, tab }}>{children}</ShellContext.Provider>;
}

/**
 * `ConsumerShellScope.of(context)?.selectTab(i)` /
 * `MerchantShellScope.of(context)?.selectTab(i)`. Null outside a shell.
 */
export function useShellScope(): ShellScope | null {
  return useContext(ShellContext);
}
