/**
 * The URL table (`lib/routes.ts`): every screen path round-trips through
 * `matchRoute`, unknown or malformed paths are 404s, and only the public
 * screens are reachable without a session.
 */
import { describe, expect, it } from "vitest";
import {
  CONSUMER_TAB_PATHS,
  MERCHANT_TAB_PATHS,
  isPublicPath,
  legalSlug,
  matchRoute,
  paths,
  routeSpace,
  type RouteMatch,
} from "../lib/routes";

const pathname = (url: string) => url.split("?")[0];

describe("paths ↔ matchRoute", () => {
  const cases: Array<[string, RouteMatch]> = [
    [paths.onboarding(), { name: "onboarding" }],
    [paths.fork(), { name: "fork" }],
    [paths.login(false), { name: "login" }],
    [paths.legal("terms"), { name: "legal", document: "terms" }],
    [paths.legal("privacy"), { name: "legal", document: "privacy" }],
    [paths.legal("refundPolicy"), { name: "legal", document: "refundPolicy" }],
    [paths.help(), { name: "help" }],
    [paths.notifications(), { name: "notifications" }],
    [paths.locationPriming(), { name: "locationPriming" }],
    [paths.detail("b1"), { name: "detail", bagId: "b1" }],
    [paths.search(), { name: "search" }],
    [paths.checkout("b1"), { name: "checkout", bagId: "b1" }],
    [paths.processing("b1", 2, "QRIS"), { name: "processing", bagId: "b1" }],
    [paths.paymentFailed("b1", 2, "QRIS"), { name: "paymentFailed", bagId: "b1" }],
    [paths.resumePayment("order-1"), { name: "resumePayment", orderId: "order-1" }],
    [paths.voucher("order-1"), { name: "voucher", orderId: "order-1" }],
    [paths.rating("order-1"), { name: "rating", orderId: "order-1" }],
    [paths.storeProfile("m1"), { name: "storeProfile", merchantId: "m1" }],
    [paths.editProfile(), { name: "editProfile" }],
    [paths.storeSetup(), { name: "storeSetup" }],
    [paths.createBag(), { name: "createBag" }],
    [paths.editBag("mb1"), { name: "editBag", bagId: "mb1" }],
    [paths.orderDetail("order-5"), { name: "orderDetail", orderId: "order-5" }],
    [paths.editStore(), { name: "editStore" }],
    [paths.merchantReviews(), { name: "merchantReviews" }],
    [paths.scanQr(), { name: "scanQr" }],
    [paths.withdrawSuccess("payout-101"), { name: "withdrawSuccess", requestId: "payout-101" }],
  ];

  it.each(cases)("%s", (url, match) => {
    expect(matchRoute(pathname(url))).toEqual(match);
  });

  it("tabs map to their index and back", () => {
    CONSUMER_TAB_PATHS.forEach((path, tab) => {
      expect(paths.consumerTab(tab)).toBe(path);
      expect(matchRoute(path)).toEqual({ name: "consumerTab", tab });
    });
    MERCHANT_TAB_PATHS.forEach((path, tab) => {
      expect(paths.merchantTab(tab)).toBe(path);
      expect(matchRoute(path)).toEqual({ name: "merchantTab", tab });
    });
    expect(paths.consumerTab(9)).toBe("/");
    expect(paths.merchantTab(-1)).toBe("/merchant");
  });

  it("uuids and Supabase ids survive the round trip", () => {
    const id = "0d8178e1-c6c7-4ab4-81a6-893be9d924ab";
    expect(matchRoute(paths.voucher(id))).toEqual({ name: "voucher", orderId: id });
    expect(matchRoute(paths.detail("bag_42"))).toEqual({ name: "detail", bagId: "bag_42" });
  });
});

describe("query strings", () => {
  it("checkout steps carry quantity and method", () => {
    expect(paths.processing("b1", 2, "QRIS")).toBe("/checkout/b1/payment?qty=2&method=QRIS");
    expect(paths.paymentFailed("b1", 1, "QRIS")).toBe("/checkout/b1/failed?qty=1&method=QRIS");
  });

  it("login keeps the role and an encoded next path", () => {
    expect(paths.login(true)).toBe("/login?role=merchant");
    expect(paths.login(false, "/orders/o-1/voucher")).toBe("/login?role=consumer&next=%2Forders%2Fo-1%2Fvoucher");
  });

  it("tab queries skip empty values", () => {
    expect(paths.consumerTab(2, { tab: "history", order: undefined, focus: "" })).toBe("/orders?tab=history");
    expect(paths.merchantTab(2, { order: "order-5" })).toBe("/merchant/orders?order=order-5");
    expect(paths.consumerTab(1, {})).toBe("/map");
  });

  it("ids are percent-encoded in paths", () => {
    expect(paths.detail("a b")).toBe("/bags/a%20b");
    expect(paths.storeProfile("m/1")).toBe("/stores/m%2F1");
  });
});

describe("matchRoute edge cases", () => {
  it("ignores trailing slashes", () => {
    expect(matchRoute("/orders/")).toEqual({ name: "consumerTab", tab: 2 });
    expect(matchRoute("/merchant/")).toEqual({ name: "merchantTab", tab: 0 });
    expect(matchRoute("/bags/b1/")).toEqual({ name: "detail", bagId: "b1" });
    expect(matchRoute("/")).toEqual({ name: "consumerTab", tab: 0 });
  });

  it.each([
    "/unknown",
    "/bags",
    "/bags/b1/extra",
    "/legal/cookies",
    "/legal",
    "/merchant/bags/mb1",
    "/merchant/bags/new/extra",
    "/merchant/balance/withdrawals",
    "/orders/o-1",
    "/orders/o-1/receipt",
    "/checkout/b1/unknown",
    "/a/b/c/d/e",
    "/profile/settings",
  ])("%s is a 404", (path) => {
    expect(matchRoute(path)).toBeNull();
  });

  it("rejects ids that are not uuids or short references", () => {
    expect(matchRoute("/bags/a%20b")).toBeNull();
    expect(matchRoute("/stores/m%2F1")).toBeNull();
    expect(matchRoute("/bags/..")).toBeNull();
    expect(matchRoute(`/bags/${"a".repeat(129)}`)).toBeNull();
    expect(matchRoute(`/bags/${"a".repeat(128)}`)).toEqual({ name: "detail", bagId: "a".repeat(128) });
  });

  it("malformed percent-encoding is a 404, not a crash", () => {
    expect(() => matchRoute("/bags/%E0%A4%A")).not.toThrow();
    expect(matchRoute("/bags/%E0%A4%A")).toBeNull();
    expect(matchRoute("/orders/%/voucher")).toBeNull();
  });

  it("decodes encoded but valid ids", () => {
    expect(matchRoute("/bags/b%31")).toEqual({ name: "detail", bagId: "b1" });
  });
});

describe("route spaces and public paths", () => {
  it("assigns every route to its workspace", () => {
    expect(routeSpace({ name: "onboarding" })).toBe("public");
    expect(routeSpace({ name: "fork" })).toBe("public");
    expect(routeSpace({ name: "login" })).toBe("public");
    expect(routeSpace({ name: "legal", document: "terms" })).toBe("public");
    expect(routeSpace({ name: "help" })).toBe("shared");
    expect(routeSpace({ name: "notifications" })).toBe("shared");
    for (const match of [
      { name: "merchantTab", tab: 1 },
      { name: "storeSetup" },
      { name: "createBag" },
      { name: "editBag", bagId: "mb1" },
      { name: "orderDetail", orderId: "o" },
      { name: "editStore" },
      { name: "merchantReviews" },
      { name: "scanQr" },
      { name: "withdrawSuccess", requestId: "p" },
    ] satisfies RouteMatch[]) {
      expect(routeSpace(match)).toBe("merchant");
    }
    for (const match of [
      { name: "consumerTab", tab: 0 },
      { name: "detail", bagId: "b1" },
      { name: "search" },
      { name: "checkout", bagId: "b1" },
      { name: "voucher", orderId: "o" },
      { name: "storeProfile", merchantId: "m1" },
      { name: "editProfile" },
      { name: "locationPriming" },
    ] satisfies RouteMatch[]) {
      expect(routeSpace(match)).toBe("consumer");
    }
  });

  it("only onboarding, the fork, login, legal pages, and the server endpoints are public", () => {
    for (const path of [
      "/onboarding",
      "/welcome",
      "/login",
      "/legal/terms",
      "/legal/privacy",
      "/legal/refund",
      "/auth/callback",
      "/api/health",
      "/api/ready",
    ]) {
      expect(isPublicPath(path)).toBe(true);
    }
    for (const path of [
      "/",
      "/map",
      "/help",
      "/notifications",
      "/bags/b1",
      "/merchant",
      "/merchant/setup",
      "/legal/cookies",
      "/api/other",
      "/unknown",
    ]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });

  it("legal slugs", () => {
    expect(legalSlug("terms")).toBe("terms");
    expect(legalSlug("privacy")).toBe("privacy");
    expect(legalSlug("refundPolicy")).toBe("refund");
  });
});
