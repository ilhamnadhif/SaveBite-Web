/**
 * URL table for every SaveBite screen. Pure (no React, no browser APIs) so the
 * server catch-all page can 404 unknown paths and the client navigator can
 * rebuild a screen from its URL after a refresh or a shared link.
 */

export type LegalDocument = "terms" | "privacy" | "refundPolicy";

export type RouteSpace = "public" | "consumer" | "merchant" | "shared";

export type RouteMatch =
  | { name: "consumerTab"; tab: number }
  | { name: "merchantTab"; tab: number }
  | { name: "onboarding" }
  | { name: "fork" }
  | { name: "login" }
  | { name: "legal"; document: LegalDocument }
  | { name: "help" }
  | { name: "notifications" }
  | { name: "locationPriming" }
  | { name: "detail"; bagId: string }
  | { name: "search" }
  | { name: "checkout"; bagId: string }
  | { name: "processing"; bagId: string }
  | { name: "paymentFailed"; bagId: string }
  | { name: "resumePayment"; orderId: string }
  | { name: "voucher"; orderId: string }
  | { name: "rating"; orderId: string }
  | { name: "storeProfile"; merchantId: string }
  | { name: "editProfile" }
  | { name: "storeSetup" }
  | { name: "createBag" }
  | { name: "editBag"; bagId: string }
  | { name: "orderDetail"; orderId: string }
  | { name: "editStore" }
  | { name: "merchantReviews" }
  | { name: "scanQr" }
  | { name: "withdrawSuccess"; requestId: string };

export const CONSUMER_TAB_PATHS = ["/", "/map", "/orders", "/favorites", "/profile"] as const;
export const MERCHANT_TAB_PATHS = ["/merchant", "/merchant/bags", "/merchant/orders", "/merchant/balance", "/merchant/profile"] as const;

const LEGAL_SLUGS: Record<string, LegalDocument> = { terms: "terms", privacy: "privacy", refund: "refundPolicy" };
export const legalSlug = (document: LegalDocument) =>
  document === "refundPolicy" ? "refund" : document;

/** Ids are uuids or short references; anything else is not a route. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;

const encode = (value: string) => encodeURIComponent(value);

export const paths = {
  consumerTab: (tab: number, query?: Record<string, string | undefined>) => withQuery(CONSUMER_TAB_PATHS[tab] ?? "/", query),
  merchantTab: (tab: number, query?: Record<string, string | undefined>) => withQuery(MERCHANT_TAB_PATHS[tab] ?? "/merchant", query),
  onboarding: () => "/onboarding",
  fork: () => "/welcome",
  login: (merchant: boolean, next?: string) => withQuery("/login", { role: merchant ? "merchant" : "consumer", next }),
  legal: (document: LegalDocument) => `/legal/${legalSlug(document)}`,
  help: () => "/help",
  notifications: () => "/notifications",
  locationPriming: () => "/location",
  detail: (bagId: string) => `/bags/${encode(bagId)}`,
  search: () => "/search",
  checkout: (bagId: string) => `/checkout/${encode(bagId)}`,
  processing: (bagId: string, qty: number, method: string) =>
    withQuery(`/checkout/${encode(bagId)}/payment`, { qty: String(qty), method }),
  paymentFailed: (bagId: string, qty: number, method: string) =>
    withQuery(`/checkout/${encode(bagId)}/failed`, { qty: String(qty), method }),
  resumePayment: (orderId: string) => `/orders/${encode(orderId)}/payment`,
  voucher: (orderId: string) => `/orders/${encode(orderId)}/voucher`,
  rating: (orderId: string) => `/orders/${encode(orderId)}/review`,
  storeProfile: (merchantId: string) => `/stores/${encode(merchantId)}`,
  editProfile: () => "/profile/edit",
  storeSetup: () => "/merchant/setup",
  createBag: () => "/merchant/bags/new",
  editBag: (bagId: string) => `/merchant/bags/${encode(bagId)}/edit`,
  orderDetail: (orderId: string) => `/merchant/orders/${encode(orderId)}`,
  editStore: () => "/merchant/store/edit",
  merchantReviews: () => "/merchant/reviews",
  scanQr: () => "/merchant/scan",
  withdrawSuccess: (requestId: string) => `/merchant/balance/withdrawals/${encode(requestId)}`,
};

function withQuery(path: string, query?: Record<string, string | undefined>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, value);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/** Matches a pathname (no query) to a route, or null for a 404. */
export function matchRoute(pathname: string): RouteMatch | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const segments = clean.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return "\u0000";
    }
  });
  const consumerTab = (CONSUMER_TAB_PATHS as readonly string[]).indexOf(clean || "/");
  if (consumerTab >= 0) return { name: "consumerTab", tab: consumerTab };
  const merchantTab = (MERCHANT_TAB_PATHS as readonly string[]).indexOf(clean);
  if (merchantTab >= 0) return { name: "merchantTab", tab: merchantTab };

  const [a, b, c, d] = segments;
  const id = (value: string | undefined) => (value && ID.test(value) ? value : null);
  switch (segments.length) {
    case 1:
      if (a === "onboarding") return { name: "onboarding" };
      if (a === "welcome") return { name: "fork" };
      if (a === "login") return { name: "login" };
      if (a === "help") return { name: "help" };
      if (a === "notifications") return { name: "notifications" };
      if (a === "location") return { name: "locationPriming" };
      if (a === "search") return { name: "search" };
      return null;
    case 2:
      if (a === "legal" && b && LEGAL_SLUGS[b]) return { name: "legal", document: LEGAL_SLUGS[b] };
      if (a === "bags" && id(b)) return { name: "detail", bagId: b };
      if (a === "checkout" && id(b)) return { name: "checkout", bagId: b };
      if (a === "stores" && id(b)) return { name: "storeProfile", merchantId: b };
      if (a === "profile" && b === "edit") return { name: "editProfile" };
      if (a === "merchant" && b === "setup") return { name: "storeSetup" };
      if (a === "merchant" && b === "reviews") return { name: "merchantReviews" };
      if (a === "merchant" && b === "scan") return { name: "scanQr" };
      return null;
    case 3:
      if (a === "checkout" && id(b) && c === "payment") return { name: "processing", bagId: b };
      if (a === "checkout" && id(b) && c === "failed") return { name: "paymentFailed", bagId: b };
      if (a === "orders" && id(b) && c === "payment") return { name: "resumePayment", orderId: b };
      if (a === "orders" && id(b) && c === "voucher") return { name: "voucher", orderId: b };
      if (a === "orders" && id(b) && c === "review") return { name: "rating", orderId: b };
      if (a === "merchant" && b === "bags" && c === "new") return { name: "createBag" };
      if (a === "merchant" && b === "orders" && id(c)) return { name: "orderDetail", orderId: c };
      if (a === "merchant" && b === "store" && c === "edit") return { name: "editStore" };
      return null;
    case 4:
      if (a === "merchant" && b === "bags" && id(c) && d === "edit") return { name: "editBag", bagId: c };
      if (a === "merchant" && b === "balance" && c === "withdrawals" && id(d)) return { name: "withdrawSuccess", requestId: d };
      return null;
    default:
      return null;
  }
}

/** Which workspace a route belongs to (for mode switching and guards). */
export function routeSpace(match: RouteMatch): RouteSpace {
  switch (match.name) {
    case "onboarding":
    case "fork":
    case "login":
    case "legal":
      return "public";
    case "help":
    case "notifications":
      return "shared";
    case "merchantTab":
    case "storeSetup":
    case "createBag":
    case "editBag":
    case "orderDetail":
    case "editStore":
    case "merchantReviews":
    case "scanQr":
    case "withdrawSuccess":
      return "merchant";
    default:
      return "consumer";
  }
}

/** Paths reachable without a session (also used by the middleware). */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/auth/callback" || pathname === "/api/health" || pathname === "/api/ready") return true;
  const match = matchRoute(pathname);
  return match !== null && routeSpace(match) === "public";
}
