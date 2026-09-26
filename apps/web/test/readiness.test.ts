import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "@savebite/web-shared";

/** Records how the query was shaped. */
const selectArgs = vi.fn();
/** Test-controlled result of `.abortSignal()`. */
const probe = vi.fn();

/** Mirrors the PostgREST builder chain: from().select().abortSignal(). */
vi.mock("@savebite/web-shared/server", () => ({
  supabaseServer: async () => ({
    from: () => ({
      select: (...args: unknown[]) => {
        selectArgs(...args);
        return { abortSignal: () => probe() };
      },
    }),
  }),
}));

const { GET: health } = await import("../app/api/health/route");
const { GET: ready } = await import("../app/api/ready/route");

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  selectArgs.mockReset();
  probe.mockReset();
  probe.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetConfigCache();
});

describe("GET /api/health", () => {
  it("is a pure liveness probe: 200 with no database access", async () => {
    const response = health();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("savebite-web");
    // A database outage must not cause a container restart loop.
    expect(selectArgs).not.toHaveBeenCalled();
  });

  it("is never cached", () => {
    expect(health().headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/ready", () => {
  it("reports ready when config is valid and the database answers", async () => {
    const response = await ready();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.checks.database.ok).toBe(true);
  });

  it("uses a HEAD-shaped query so the probe transfers no rows", async () => {
    await ready();
    expect(selectArgs).toHaveBeenCalledWith("*", expect.objectContaining({ head: true }));
  });

  it("returns 503 so a load balancer stops sending traffic", async () => {
    probe.mockResolvedValue({ error: { message: "connection terminated" } });
    const response = await ready();
    expect(response.status).toBe(503);
    expect((await response.json()).status).toBe("not_ready");
  });

  it("reports not-ready when required configuration is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    resetConfigCache();

    const response = await ready();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.checks.config.missing).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("never leaks configuration values", async () => {
    probe.mockResolvedValue({ error: { message: "boom" } });
    const body = JSON.stringify(await (await ready()).json());
    expect(body).not.toContain("sb_publishable_test");
    expect(body).not.toContain("Mid-client-test");
  });

  it("retries a transient failure before giving up", async () => {
    probe
      .mockResolvedValueOnce({ error: { message: "ECONNRESET" } })
      .mockResolvedValueOnce({ error: null });

    const response = await ready();
    expect(response.status).toBe(200);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("stops retrying once the attempt budget is spent", async () => {
    probe.mockResolvedValue({ error: { message: "ECONNRESET" } });
    const response = await ready();
    expect(response.status).toBe(503);
    // Bounded: an unbounded retry here would hang every health check.
    expect(probe.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("handles a thrown error, not just an error field", async () => {
    probe.mockRejectedValue(new Error("getaddrinfo ENOTFOUND db.internal"));
    const response = await ready();
    expect(response.status).toBe(503);
  });

  it("never reports ready while config is invalid", async () => {
    process.env.NEXT_PUBLIC_MIDTRANS_ENVIRONMENT = "staging";
    resetConfigCache();

    const response = await ready();
    expect(response.status).toBe(503);
    expect((await response.json()).checks.config.invalid).toContain(
      "NEXT_PUBLIC_MIDTRANS_ENVIRONMENT",
    );
  });
});
