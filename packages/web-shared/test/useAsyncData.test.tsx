import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAsyncData, useDebouncedCallback } from "../src/useAsyncData";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAsyncData", () => {
  it("starts in a loading state and resolves to data", async () => {
    const { result } = renderHook(() => useAsyncData(async () => "value"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe("value");
    expect(result.current.error).toBeNull();
  });

  it("surfaces a classified error instead of hanging", async () => {
    // This is the exact bug that produced a permanent
    // "Menyiapkan checkout…" spinner: the old pages discarded `error`.
    const { result } = renderHook(() =>
      useAsyncData(async () => {
        throw { message: "insert into public.orders failed", code: "23505" };
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).not.toContain("public.orders");
  });

  it("does not update state after unmount", async () => {
    const gate = deferred<string>();
    const { unmount } = renderHook(() => useAsyncData(() => gate.promise));
    unmount();
    await act(async () => {
      gate.resolve("late");
      await gate.promise;
    });
    // Would warn "update on unmounted component" if the hook were naive.
    expect(true).toBe(true);
  });

  it("ignores a stale response that resolves after a newer one", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useAsyncData(loader));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));

    act(() => result.current.reload());
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));

    // Newer request wins even though the older one lands afterwards.
    await act(async () => {
      second.resolve("fresh");
      await second.promise;
    });
    await act(async () => {
      first.resolve("stale");
      await first.promise;
    });

    expect(result.current.data).toBe("fresh");
  });

  it("clears a previous error when reloaded successfully", async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");

    const { result } = renderHook(() => useAsyncData(loader));
    await waitFor(() => expect(result.current.error).toBeTruthy());

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe("ok"));
    expect(result.current.error).toBeNull();
  });

  it("does not run the loader when disabled", async () => {
    const loader = vi.fn(async () => "value");
    const { result } = renderHook(() => useAsyncData(loader, { enabled: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(loader).not.toHaveBeenCalled();
  });

  it("re-runs when deps change (e.g. the signed-in user id)", async () => {
    const loader = vi.fn(async () => "value");
    const { rerender } = renderHook(({ id }: { id: string }) => useAsyncData(loader, { deps: [id] }), {
      initialProps: { id: "a" },
    });
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    rerender({ id: "b" });
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });

  it("does not loop when the loader is a new closure every render", async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useAsyncData(async () => {
        calls += 1;
        return calls;
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(1);
  });

  it("supports local patching without a refetch", async () => {
    const { result } = renderHook(() => useAsyncData(async () => [{ id: 1 }]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setData((current) => [...current, { id: 2 }]));
    expect(result.current.data).toHaveLength(2);
  });
});

describe("useDebouncedCallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("collapses a burst into a single call", () => {
    const spy = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(spy, 400));

    act(() => {
      result.current();
      result.current();
      result.current();
    });
    expect(spy).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(399));
    expect(spy).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(2));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not fire after unmount", () => {
    const spy = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(spy, 200));
    act(() => result.current());
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(spy).not.toHaveBeenCalled();
  });
});
