import { describe, expect, it } from "vitest";
import { makeIdempotencyKey, rupiah, shortDate } from "../src/format";

describe("rupiah", () => {
  it("formats Indonesian rupiah without decimals", () => {
    const text = rupiah(15000);
    expect(text).toContain("15.000");
    expect(text).not.toContain(",00");
  });

  it("handles zero, strings and nullish input without throwing", () => {
    expect(rupiah(0)).toContain("0");
    expect(rupiah("25000")).toContain("25.000");
    expect(rupiah(null)).toContain("0");
    expect(rupiah(undefined)).toContain("0");
  });

  it("does not produce NaN for garbage input", () => {
    expect(rupiah("abc")).not.toContain("NaN");
  });
});

describe("shortDate", () => {
  it("formats an ISO timestamp", () => {
    expect(shortDate("2025-01-15T10:30:00.000Z")).toMatch(/2025/);
  });

  it("renders a dash for missing values", () => {
    expect(shortDate(null)).toBe("—");
    expect(shortDate(undefined)).toBe("—");
    expect(shortDate("")).toBe("—");
  });
});

describe("makeIdempotencyKey", () => {
  it("produces unique values", () => {
    const keys = new Set(Array.from({ length: 500 }, () => makeIdempotencyKey()));
    expect(keys.size).toBe(500);
  });

  it("is a non-empty string", () => {
    expect(makeIdempotencyKey().length).toBeGreaterThan(8);
  });
});
