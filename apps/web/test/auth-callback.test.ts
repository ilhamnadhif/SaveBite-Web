import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const setAllCallbacks: Array<(cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => void> = [];

vi.mock("@savebite/web-shared/server", () => ({
  supabaseServer: async () => ({
    auth: { exchangeCodeForSession },
    cookies: {
      getAll: () => [],
      setAll: (fn: (typeof setAllCallbacks)[number]) => setAllCallbacks.push(fn),
    },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const { GET } = await import("../app/auth/callback/route");

const ORIGIN = "https://app.savebite.com";
const call = (query: string) =>
  GET(new Request(`${ORIGIN}/auth/callback${query}`)) as Promise<Response>;

const CONFIGURED_CALLBACK = process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL = `${ORIGIN}/auth/callback`;
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
  setAllCallbacks.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects to a safe next path", async () => {
    const response = await call("?code=abc&next=%2Fmerchant%2Forders");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/merchant/orders`);
  });

  it("uses 303 so the browser cannot replay the one-time code", async () => {
    const response = await call("?code=abc");
    expect(response.status).not.toBe(302);
  });

  it.each([
    ["https://evil.example/steal"],
    ["//evil.example/steal"],
    ["/\\evil.example"],
    ["javascript:alert(1)"],
    ["merchant/orders"],
  ])("refuses to redirect off-origin for next=%s", async (next) => {
    const response = await call(`?code=abc&next=${encodeURIComponent(next)}`);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/");
  });

  it("handles a missing code without calling Supabase", async () => {
    const response = await call("");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
  });

  it("reports a failed exchange instead of silently redirecting", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: null, error: { message: "invalid code" } });
    const response = await call("?code=stale");
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/login");
    // The user gets a reason rather than a redirect that appears to do nothing.
    expect(location.searchParams.get("error")).toBe("exchange_failed");
    expect(location.searchParams.get("error")).not.toContain("Supabase URL");
  });

  it("keeps the merchant role and deep link when the exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: null, error: { message: "invalid code" } });
    const response = await call("?code=stale&next=%2Fmerchant%2Forders");
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("role")).toBe("merchant");
    expect(location.searchParams.get("next")).toBe("/merchant/orders");
  });

  it("redirects to the public origin, not the container's own address", async () => {
    // The standalone server inside Docker sees http://0.0.0.0:3000 while the
    // browser is on the published port.
    process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL = "http://43.133.46.121:3002/auth/callback";
    const response = (await GET(new Request("http://0.0.0.0:3000/auth/callback?code=abc&next=%2F"))) as Response;
    expect(response.headers.get("location")).toBe("http://43.133.46.121:3002/");

    exchangeCodeForSession.mockResolvedValue({ data: null, error: { message: "invalid code" } });
    const failed = (await GET(new Request("http://0.0.0.0:3000/auth/callback?code=stale"))) as Response;
    expect(new URL(failed.headers.get("location")!).origin).toBe("http://43.133.46.121:3002");
  });

  it("falls back to the request origin without a usable callback URL", async () => {
    process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL = "not a url";
    const response = await call("?code=abc");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    delete process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL;
    const unset = await call("?code=abc");
    expect(unset.headers.get("location")).toBe(`${ORIGIN}/`);
    process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL = CONFIGURED_CALLBACK;
  });

  it("recovers when Supabase itself throws", async () => {
    exchangeCodeForSession.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.1:5432"));
    const response = await call("?code=abc");
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });
});
