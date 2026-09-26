import { describe, expect, it } from "vitest";
import { isSafeNextPath, safeNextPath } from "../src/redirect";

/**
 * Security regression tests.
 *
 * `next` is attacker-controllable on both `/login` and `/auth/callback`. If any
 * of these cases regress, the app becomes an open redirect that lands victims on
 * a phishing page *after* a genuine Google sign-in.
 */
describe("safeNextPath", () => {
  it("accepts ordinary same-origin paths", () => {
    expect(safeNextPath("/merchant/orders")).toBe("/merchant/orders");
    expect(safeNextPath("/orders?order=abc-123")).toBe("/orders?order=abc-123");
    expect(safeNextPath("/bags/9f1c#reviews")).toBe("/bags/9f1c#reviews");
    expect(safeNextPath("/")).toBe("/");
  });

  it("preserves the query string verbatim (no double-decoding)", () => {
    expect(safeNextPath("/search?q=a+b&x=1")).toBe("/search?q=a+b&x=1");
    expect(safeNextPath("/search?q=%E5%9B%BA")).toBe("/search?q=%E5%9B%BA");
  });

  it.each([
    ["absolute URL", "https://evil.example/steal"],
    ["protocol-relative", "//evil.example/steal"],
    ["backslash protocol-relative", "/\\evil.example/steal"],
    ["scheme-only", "javascript:alert(1)"],
    ["data URL", "data:text/html,<script>alert(1)</script>"],
    ["no leading slash", "merchant/orders"],
    ["empty", ""],
    ["whitespace", "   "],
  ])("rejects %s", (_label, candidate) => {
    expect(safeNextPath(candidate)).toBe("/");
    expect(isSafeNextPath(candidate)).toBe(false);
  });

  it("rejects control characters used for header/URL splitting", () => {
    const withNewline = `/merchant/orders\nSet-Cookie: x=1`;
    const withTab = "/merchant/orders\t/../admin";
    expect(safeNextPath(withNewline)).toBe("/");
    expect(safeNextPath(withTab)).toBe("/");
  });

  it("rejects credentials embedded in the authority", () => {
    expect(safeNextPath("//user:pass@evil.example")).toBe("/");
  });

  it("honours an explicit fallback", () => {
    expect(safeNextPath("https://evil.example", { fallback: "/merchant" })).toBe("/merchant");
    expect(safeNextPath(null, { fallback: "/merchant" })).toBe("/merchant");
    expect(safeNextPath(undefined, { fallback: "/merchant" })).toBe("/merchant");
  });

  describe("role isolation", () => {
    it("keeps a consumer session out of the merchant workspace", () => {
      expect(safeNextPath("/merchant/orders", { requirePrefix: "/" })).toBe("/");
      expect(safeNextPath("/merchant", { requirePrefix: "/" })).toBe("/");
      expect(safeNextPath("/merchant?tab=x", { requirePrefix: "/" })).toBe("/");
      expect(safeNextPath("/orders", { requirePrefix: "/" })).toBe("/orders");
      expect(safeNextPath("/", { requirePrefix: "/" })).toBe("/");
    });

    it("keeps a merchant session out of consumer-only pages", () => {
      expect(safeNextPath("/orders", { requirePrefix: "/merchant" })).toBe("/");
      expect(safeNextPath("/merchant/balance", { requirePrefix: "/merchant" })).toBe(
        "/merchant/balance",
      );
      expect(safeNextPath("/merchant", { requirePrefix: "/merchant" })).toBe("/merchant");
    });
  });
});
