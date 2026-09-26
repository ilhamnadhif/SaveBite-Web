"use client";

/**
 * The single data-loading primitive used by every page in the app.
 *
 * Before this existed, ~15 pages each hand-rolled their own
 * `useEffect + loading + error` trio and, almost without exception, threw the
 * `error` away:
 *
 *     .maybeSingle().then(({ data }) => setBag(data ?? null));
 *
 * A failed query therefore looked exactly like an empty result, which showed up
 * as a spinner that never ends (`"Menyiapkan checkout…"` forever) or a misleading
 * empty state. This hook makes the three concerns impossible to get wrong:
 *
 *   - out-of-order responses cannot clobber a newer one (request sequence);
 *   - state is never set after unmount;
 *   - errors are classified into safe, user-facing text and logged.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { describeError } from "./errors";

export type AsyncDataOptions<T> = {
  /** Extra dependencies that should trigger a reload. */
  deps?: readonly unknown[];
  /** When false the loader is not run (e.g. no signed-in user yet). */
  enabled?: boolean;
  /** Value exposed before the first successful load. */
  initialData?: T;
  /** Log/metric scope, e.g. `"catalog.load"`. */
  scope?: string;
};

export type AsyncDataResult<T> = {
  data: T;
  loading: boolean;
  /** Safe, user-facing message, or null. */
  error: string | null;
  /** Re-runs the loader. */
  reload: () => void;
  /** Locally patches loaded data without a round trip. */
  setData: (updater: T | ((current: T) => T)) => void;
};

export function useAsyncData<T>(
  loader: () => Promise<T>,
  options: AsyncDataOptions<T> = {},
): AsyncDataResult<T> {
  const { deps = [], enabled = true, scope = "data.load" } = options;

  const [data, setDataState] = useState<T>(options.initialData as T);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const requestId = useRef(0);
  const mounted = useRef(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    // Invalidate any in-flight request so a slow earlier response cannot win.
    const current = ++requestId.current;
    const isStale = () => !mounted.current || requestId.current !== current;

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await loaderRef.current();
        if (isStale()) return;
        setDataState(result);
      } catch (caught) {
        if (isStale()) return;
        setError(describeError(caught, scope));
      } finally {
        if (!isStale()) setLoading(false);
      }
    })();
    // `loader` is intentionally read through a ref: callers pass inline
    // closures, and depending on the identity would loop forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, scope, ...deps]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const setData = useCallback((updater: T | ((current: T) => T)) => {
    setDataState((current) =>
      typeof updater === "function" ? (updater as (previous: T) => T)(current) : updater,
    );
  }, []);

  return { data, loading, error, reload, setData };
}

/**
 * Debounces a callback. Used to coalesce bursts of realtime change events into
 * a single refetch instead of one request per row mutation.
 */
export function useDebouncedCallback(callback: () => void, delayMs: number): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (mounted.current) callbackRef.current();
    }, delayMs);
  }, [delayMs]);
}
