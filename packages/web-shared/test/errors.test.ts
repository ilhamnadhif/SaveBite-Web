import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { classifyError, describeError } from "../src/errors";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Mimics the shape supabase-js puts on a PostgrestError. */
function pgError(message: string, code?: string, extra: Record<string, unknown> = {}) {
  return { message, code, details: null, hint: null, ...extra };
}

describe("classifyError", () => {
  it("maps a duplicate-key violation to a safe message", () => {
    const result = classifyError(pgError("duplicate key value violates unique constraint", "23505"));
    expect(result.kind).toBe("duplicate");
    expect(result.message).toBe("Data ini sudah pernah dibuat.");
    expect(result.message).not.toContain("constraint");
  });

  it("maps an expired session to a re-login prompt", () => {
    expect(classifyError(pgError("JWT expired", "PGRST301")).kind).toBe("jwt_expired");
  });

  it("treats a missing row as not-found", () => {
    expect(classifyError(pgError("no rows found", "PGRST116")).kind).toBe("not_found");
  });

  it("marks infrastructure errors as retryable and auth errors as not", () => {
    expect(classifyError(pgError("canceling statement due to statement timeout", "57014")).retryable).toBe(true);
    expect(classifyError(pgError("permission denied for table orders", "42501")).retryable).toBeFalsy();
  });

  it.each([
    ["not authenticated"],
    ["order not found"],
    ["order is not redeemable"],
    ["order has expired"],
    ["pickup window has not started"],
    ["pickup window has ended"],
    ["merchant not found"],
  ])("surfaces our own RPC message %j verbatim", (message) => {
    const result = classifyError(pgError(message));
    expect(result.message).not.toBe("Terjadi kendala. Coba lagi sebentar.");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("NEVER leaks raw SQL or schema names to the UI", () => {
    const leaky = [
      pgError('insert into "public"."orders" ... violates foreign key constraint "orders_x_fkey"'),
      pgError("ERROR: stack trace: PL/pgSQL function public.issue_pickup_manual_code() line 61"),
      pgError("select * from pg_catalog.pg_tables"),
      pgError("connection to postgres://user:pass@db.internal:5432 failed"),
      pgError("Failed to fetch"),
    ];
    for (const error of leaky) {
      const message = classifyError(error).message;
      expect(message).not.toMatch(/select|insert into|pg_catalog|PL\/pgSQL|postgres:\/\//i);
      expect(message.length).toBeLessThan(200);
    }
  });

  it("recognises a network failure as retryable", () => {
    const result = classifyError(new TypeError("Failed to fetch"));
    expect(result.kind).toBe("unavailable");
    expect(result.retryable).toBe(true);
  });

  it("keeps a safe RLS message actionable", () => {
    const result = classifyError(pgError("new row violates row-level security policy", "42501"));
    expect(result.message).toMatch(/row-level security|aturan akses/i);
  });

  it("falls back safely for null/undefined/empty values", () => {
    expect(classifyError(null).kind).toBe("unknown");
    expect(classifyError(undefined).kind).toBe("unknown");
    expect(classifyError({}).message).toBe("Terjadi kendala. Coba lagi sebentar.");
  });

  it("does not echo a token that leaked into an error message", () => {
    const message = classifyError(
      pgError("rejected token sb_secret_abcdefghijklmnopqrstuvwxyz0123456789"),
    ).message;
    expect(message).not.toContain("sb_secret_abcdefghijklmnopqrstuvwxyz0123456789");
  });
});

describe("describeError", () => {
  it("returns the safe message and logs the original for debugging", () => {
    const original = pgError("insert into public.orders failed: connection terminated", "08006");
    const message = describeError(original, "checkout.create", { bagId: "abc" });
    expect(message).not.toContain("public.orders");
    expect(console.error).toHaveBeenCalled();
  });

  it("keeps a plain Error message when it is safe to show", () => {
    expect(describeError(new Error("Kode pickup sudah kedaluwarsa."), "redeem")).toBe(
      "Kode pickup sudah kedaluwarsa.",
    );
  });
});
