"use client";

import type { ReactNode } from "react";

/**
 * A Flutter-style `Navigator` for the browser.
 *
 * The SaveBite app navigates like the mobile app: screens are pushed on a
 * stack, the screens beneath stay mounted (their scroll position and form
 * state survive), routes can return a value on pop, and "root" navigation
 * (`pushAndRemoveUntil`) clears the stack. Every entry still has a URL so a
 * refresh or a shared link rebuilds the same screen (see `restore`).
 *
 * Browser history mirrors the stack. Each pushed entry owns exactly one
 * history entry (`pushed`); entries rebuilt from a deep link share the base
 * history entry (`pushed: false`). Root navigation rewinds the history it owns
 * with `history.go(-n)` so the browser back button can never return into a
 * flow the app has closed (for example a finished checkout).
 */

export type Transition = "push" | "fade" | "none";

export type RouteSpec = {
  /** Path and query shown in the address bar. */
  url: string;
  /** Builds the screen once for the entry. */
  build: () => ReactNode;
  /** Flutter `RouteSettings.name`, for lookups such as the checkout route. */
  name?: string;
  transition?: Transition;
};

/** Return `true` to block a pop (Flutter `PopScope(canPop: false)`). */
export type PopGuard = () => boolean;

export type NavEntry = {
  readonly key: string;
  url: string;
  readonly name?: string;
  readonly element: ReactNode;
  readonly transition: Transition;
  /** Owns a browser history entry created with pushState. */
  pushed: boolean;
  /** Shell only: owns an extra history entry for a non-home tab. */
  tabPushed: boolean;
  result: unknown;
  resolve: (value: unknown) => void;
  guard?: PopGuard;
  onTabPop?: (tab: number) => void;
};

type HistoryState = { sb?: { key: string; tab?: number; overlay?: string } } | null;

let sequence = 0;
const nextKey = () => `r${Date.now().toString(36)}${(sequence++).toString(36)}`;

class AppNavigator {
  private entries: NavEntry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: readonly NavEntry[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private internalPops: Array<() => void> = [];
  private forwardCache = new Map<string, NavEntry>();
  private restoreFromUrl: ((url: string) => RouteSpec[] | null) | null = null;
  private attached = false;
  /** Open modal overlays (bottom sheets, dialogs), each owning one history entry. */
  private overlays: Array<{ id: string; close: () => void }> = [];

  /** Installs the popstate listener and the deep-link restorer. */
  attach(restore: (url: string) => RouteSpec[] | null): () => void {
    this.restoreFromUrl = restore;
    if (this.attached || typeof window === "undefined") return () => undefined;
    this.attached = true;
    window.addEventListener("popstate", this.onPopState);
    return () => {
      window.removeEventListener("popstate", this.onPopState);
      this.attached = false;
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  get stack(): readonly NavEntry[] {
    return this.snapshot;
  }

  get top(): NavEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /** True when a pop would reveal another screen. */
  canPop(): boolean {
    return this.entries.length > 1;
  }

  /** Index of the first entry with `name`, or -1. */
  indexOfName(name: string): number {
    return this.entries.findIndex((entry) => entry.name === name);
  }

  /** Replaces the whole stack (startup, deep links). Rewinds owned history. */
  reset(specs: RouteSpec[], transition: Transition = "fade"): Promise<void> {
    return this.run(async () => {
      await this.dropOverlays();
      const steps = this.ownedHistory(0);
      if (steps > 0) await this.historyGo(-steps);
      const previous = this.entries;
      this.entries = specs.map((spec, index) =>
        this.createEntry(spec, () => undefined, false, index === specs.length - 1 ? transition : "none"),
      );
      const top = this.top;
      if (top) this.writeState("replace", top);
      this.forwardCache.clear();
      for (const entry of previous) entry.resolve(undefined);
      this.emit();
    });
  }

  /** `Navigator.push`. Resolves with the value the route pops with. */
  push<T = unknown>(spec: RouteSpec): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      void this.run(async () => {
        await this.dropOverlays();
        const entry = this.createEntry(spec, resolve as (value: unknown) => void, true, spec.transition ?? "push");
        this.writeState("push", entry);
        this.entries = [...this.entries, entry];
        this.forwardCache.clear();
        this.emit();
      });
    });
  }

  /** `Navigator.pushReplacement`. */
  replace(spec: RouteSpec): Promise<void> {
    return this.run(async () => {
      await this.dropOverlays();
      const old = this.entries[this.entries.length - 1];
      const entry = this.createEntry(spec, () => undefined, old?.pushed ?? false, spec.transition ?? "push");
      this.writeState("replace", entry);
      this.entries = [...this.entries.slice(0, -1), entry];
      this.emit();
      old?.resolve(undefined);
    });
  }

  /** `Navigator.pushAndRemoveUntil(route, (_) => false)`. */
  root(spec: RouteSpec): Promise<void> {
    return this.reset([spec], spec.transition ?? "fade");
  }

  /**
   * Removes every entry above `index`, then pushes `spec` — Flutter's
   * `removeRoute(...)` followed by `pushReplacement(...)`.
   */
  popUntilAndPush(index: number, spec: RouteSpec): Promise<void> {
    return this.run(async () => {
      if (index < 0 || index >= this.entries.length) return;
      await this.dropOverlays();
      const removed = this.entries.slice(index + 1);
      const steps = this.ownedHistory(index + 1);
      if (steps > 0) await this.historyGo(-steps);
      if (removed.some((entry) => !entry.pushed)) this.writeState("replace", this.entries[index]);
      this.entries = this.entries.slice(0, index + 1);
      const entry = this.createEntry(spec, () => undefined, true, spec.transition ?? "push");
      this.writeState("push", entry);
      this.entries = [...this.entries, entry];
      this.forwardCache.clear();
      this.emit();
      for (const item of removed) item.resolve(undefined);
    });
  }

  /** `Navigator.pop(result)`: ignores pop guards. No-op on the last route. */
  pop(result?: unknown): Promise<boolean> {
    return this.run(async () => {
      if (this.entries.length <= 1) return false;
      await this.dropOverlays();
      await this.popTop(result);
      return true;
    });
  }

  /** `Navigator.maybePop(result)`: respects the top route's pop guard. */
  maybePop(result?: unknown): Promise<boolean> {
    const top = this.top;
    if (!top || this.entries.length <= 1) return Promise.resolve(false);
    if (top.guard?.()) return Promise.resolve(false);
    return this.pop(result);
  }

  /** Registers a `PopScope` guard for the entry. */
  setGuard(key: string, guard: PopGuard | undefined) {
    const entry = this.entries.find((item) => item.key === key);
    if (entry) entry.guard = guard;
  }

  /** Lets a shell react when the browser pops its tab history entry. */
  setTabListener(key: string, listener: ((tab: number) => void) | undefined) {
    const entry = this.entries.find((item) => item.key === key);
    if (entry) entry.onTabPop = listener;
  }

  /**
   * Called by a shell when its selected tab changes. Leaving the home tab
   * pushes one history entry so the browser back button returns to home
   * first, exactly like the shell's `PopScope(canPop: index == 0)`.
   */
  setTab(key: string, tab: number, url: string): Promise<void> {
    return this.run(async () => {
      const entry = this.entries.find((item) => item.key === key);
      if (!entry) return;
      const isTop = entry === this.top;
      if (!isTop) {
        entry.url = url;
        return;
      }
      if (tab === 0) {
        if (entry.tabPushed) {
          await this.historyGo(-1);
          entry.tabPushed = false;
        }
        entry.url = url;
        this.writeState("replace", entry, 0);
      } else if (!entry.tabPushed) {
        entry.tabPushed = true;
        entry.url = url;
        this.writeState("push", entry, tab);
      } else {
        entry.url = url;
        this.writeState("replace", entry, tab);
      }
    });
  }

  /**
   * A shell opened directly on a non-home tab (deep link, notification)
   * gets a home entry beneath it, so back returns to the home tab first.
   */
  ensureHomeBeneath(key: string, tab: number, homeUrl: string): Promise<void> {
    return this.run(async () => {
      const entry = this.entries.find((item) => item.key === key);
      if (!entry || entry !== this.top || tab === 0 || entry.tabPushed) return;
      const url = entry.url;
      entry.url = homeUrl;
      this.writeState("replace", entry, 0);
      entry.tabPushed = true;
      entry.url = url;
      this.writeState("push", entry, tab);
    });
  }

  /**
   * A modal sheet/dialog opened over the current route. It owns one history
   * entry so the browser back button closes it, like a Flutter modal route.
   * `close` is called when the browser (not the app) dismisses it.
   */
  openOverlay(id: string, close: () => void): Promise<void> {
    return this.run(async () => {
      const top = this.top;
      if (typeof window === "undefined" || !top) return;
      this.overlays.push({ id, close });
      const current = (window.history.state as HistoryState)?.sb;
      const data: HistoryState = { sb: { key: top.key, ...(current?.tab ? { tab: current.tab } : {}), overlay: id } };
      try {
        window.history.pushState(data, "", top.url);
      } catch {
        // Overlay still works without a history entry.
      }
    });
  }

  /** Called when the app itself dismisses an overlay. */
  closeOverlay(id: string): Promise<void> {
    return this.run(async () => {
      const index = this.overlays.findIndex((overlay) => overlay.id === id);
      if (index < 0) return;
      const above = this.overlays.length - index;
      this.overlays.splice(index);
      await this.historyGo(-above);
    });
  }

  // ---------------------------------------------------------------------- //

  /** Dismisses every overlay before the stack changes underneath it. */
  private async dropOverlays() {
    if (!this.overlays.length) return;
    const open = this.overlays.splice(0);
    await this.historyGo(-open.length);
    for (const overlay of open.reverse()) overlay.close();
  }

  private createEntry(
    spec: RouteSpec,
    resolve: (value: unknown) => void,
    pushed: boolean,
    transition: Transition,
  ): NavEntry {
    let settled = false;
    return {
      key: nextKey(),
      url: spec.url,
      name: spec.name,
      element: spec.build(),
      transition,
      pushed,
      tabPushed: false,
      result: undefined,
      resolve: (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      },
    };
  }

  private ownedHistory(fromIndex: number): number {
    let steps = 0;
    for (const [index, entry] of this.entries.entries()) {
      if (index < fromIndex) {
        continue;
      }
      if (entry.pushed) steps += 1;
      if (entry.tabPushed) steps += 1;
    }
    return steps;
  }

  private async popTop(result: unknown) {
    const top = this.entries[this.entries.length - 1];
    const below = this.entries[this.entries.length - 2];
    top.result = result;
    const steps = (top.pushed ? 1 : 0) + (top.tabPushed ? 1 : 0);
    if (steps > 0) await this.historyGo(-steps);
    if (!top.pushed) this.writeState("replace", below, below.tabPushed ? undefined : 0);
    this.entries = this.entries.slice(0, -1);
    this.forwardCache.set(top.key, top);
    this.emit();
    top.resolve(result);
  }

  private onPopState = (event: PopStateEvent) => {
    const waiter = this.internalPops.shift();
    if (waiter) {
      waiter();
      return;
    }
    const state = event.state as HistoryState;
    const key = state?.sb?.key;
    const tab = state?.sb?.tab ?? 0;
    const overlay = this.overlays[this.overlays.length - 1];
    if (overlay && state?.sb?.overlay !== overlay.id) {
      // Back while a sheet/dialog is open closes it, nothing else.
      this.overlays.pop();
      overlay.close();
      return;
    }
    void this.run(async () => {
      this.handleBrowserPop(key, tab);
    });
  };

  private handleBrowserPop(key: string | undefined, tab: number) {
    const index = key ? this.entries.findIndex((entry) => entry.key === key) : -1;
    const topIndex = this.entries.length - 1;

    if (index === topIndex && index >= 0) {
      // The shell's tab entry was popped: back to its home tab.
      const top = this.entries[index];
      top.tabPushed = tab !== 0;
      top.onTabPop?.(tab);
      return;
    }

    if (index >= 0 && index < topIndex) {
      const top = this.entries[topIndex];
      if (index === topIndex - 1 && top.guard?.()) {
        // PopScope(canPop: false): put the entry back; the guard has already
        // run its own navigation (if any).
        this.writeState("push", top, top.tabPushed ? 1 : 0);
        return;
      }
      const removed = this.entries.slice(index + 1);
      this.entries = this.entries.slice(0, index + 1);
      const target = this.entries[index];
      if (target.tabPushed && tab === 0) {
        target.tabPushed = false;
        target.onTabPop?.(0);
      }
      for (const entry of removed) this.forwardCache.set(entry.key, entry);
      this.emit();
      for (const entry of removed.reverse()) entry.resolve(entry.result);
      return;
    }

    // Unknown key: a forward navigation or a history entry from an earlier
    // page load. Restore the popped entry if we still have it, otherwise
    // rebuild the stack from the URL.
    const cached = key ? this.forwardCache.get(key) : undefined;
    if (cached) {
      this.forwardCache.delete(cached.key);
      cached.pushed = true;
      cached.tabPushed = false;
      cached.result = undefined;
      this.entries = [...this.entries, { ...cached, resolve: () => undefined }];
      this.emit();
      return;
    }
    const url = `${window.location.pathname}${window.location.search}`;
    const specs = this.restoreFromUrl?.(url);
    if (!specs?.length) return;
    const previous = this.entries;
    this.entries = specs.map((spec, i) => this.createEntry(spec, () => undefined, false, i === specs.length - 1 ? "fade" : "none"));
    const top = this.top;
    if (top) this.writeState("replace", top);
    this.emit();
    for (const entry of previous) entry.resolve(undefined);
  }

  private writeState(mode: "push" | "replace", entry: NavEntry, tab?: number) {
    if (typeof window === "undefined") return;
    const data: HistoryState = { sb: { key: entry.key, ...(tab ? { tab } : {}) } };
    try {
      if (mode === "push") window.history.pushState(data, "", entry.url);
      else window.history.replaceState(data, "", entry.url);
    } catch {
      // A malformed URL must never break navigation; the screen still renders.
    }
  }

  private historyGo(delta: number): Promise<void> {
    if (typeof window === "undefined" || delta === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      // history.go(-n) dispatches exactly one popstate.
      this.internalPops.push(finish);
      const timer = setTimeout(() => {
        const position = this.internalPops.indexOf(finish);
        if (position >= 0) this.internalPops.splice(position, 1);
        finish();
      }, 1200);
      window.history.go(delta);
    });
  }

  /** Serialises navigation so overlapping taps cannot interleave history. */
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private emit() {
    this.snapshot = [...this.entries];
    for (const listener of this.listeners) listener();
  }
}

/** The app's single navigator (Flutter's global `navigatorKey`). */
export const navigator = new AppNavigator();
