/**
 * Notification route parsing, ported from `lib/services/notification_route.dart`.
 */

export type ConsumerOrdersTab = "active" | "history";
export type MerchantOrdersTab = "active" | "closed";

export type ConsumerOrderNotificationTarget = { orderId: string; preferredTab: ConsumerOrdersTab | null };
export type MerchantOrderNotificationTarget = { orderId: string; preferredTab: MerchantOrdersTab | null };

const TERMINAL_ORDER_ROUTE_STATUSES = new Set([
  "cancelled",
  "canceled",
  "complete",
  "completed",
  "disputed",
  "done",
  "expired",
  "failed",
  "payment-review",
  "redeemed",
  "refunded",
  "reviewed",
]);

const ACTIVE_ORDER_ROUTE_STATUSES = new Set(["awaiting-payment", "new", "paid", "pending", "processing", "ready"]);

const STATIC_NOTIFICATION_ROUTES = new Set([
  "consumer_home",
  "home",
  "merchant_balance",
  "merchant_orders",
  "merchant_reviews",
  "orders",
]);

const NOTIFICATION_ORDER_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Reads `order:<id>:<status>` without treating the status as final truth.
 * The orders screen still matches the id against fresh data.
 */
export function parseConsumerOrderNotificationRoute(value: string | null | undefined): ConsumerOrderNotificationTarget | null {
  const route = value?.trim() ?? "";
  const parts = route.split(":");
  if ((parts.length !== 2 && parts.length !== 3) || parts[0].trim().toLowerCase() !== "order") return null;
  const orderId = parts[1].trim();
  if (!orderId) return null;
  const status = parts.length > 2 ? parts[2].trim().toLowerCase() : "";
  const preferredTab: ConsumerOrdersTab | null = TERMINAL_ORDER_ROUTE_STATUSES.has(status)
    ? "history"
    : ACTIVE_ORDER_ROUTE_STATUSES.has(status)
      ? "active"
      : null;
  return { orderId, preferredTab };
}

/** Reads the merchant route `merchant-order:<id>:<status>`. */
export function parseMerchantOrderNotificationRoute(value: string | null | undefined): MerchantOrderNotificationTarget | null {
  const route = value?.trim() ?? "";
  const parts = route.split(":");
  if ((parts.length !== 2 && parts.length !== 3) || parts[0].trim().toLowerCase() !== "merchant-order") return null;
  const orderId = parts[1].trim();
  if (!orderId) return null;
  const status = parts.length > 2 ? parts[2].trim().toLowerCase() : "";
  const preferredTab: MerchantOrdersTab | null = TERMINAL_ORDER_ROUTE_STATUSES.has(status)
    ? "closed"
    : ACTIVE_ORDER_ROUTE_STATUSES.has(status)
      ? "active"
      : null;
  return { orderId, preferredTab };
}

/** Shared by navigation and the realtime listener. */
export function isMerchantOrdersNotificationRoute(value: string | null | undefined): boolean {
  const route = value?.trim() ?? "";
  return route.toLowerCase() === "merchant_orders" || parseMerchantOrderNotificationRoute(route) !== null;
}

/**
 * Allows only known navigation targets. For values from `dedupe_key`, pass
 * `dynamicOrderOnly` so arbitrary keys never become app routes.
 */
export function whitelistedNotificationRoute(
  value: string | null | undefined,
  { dynamicOrderOnly = false }: { dynamicOrderOnly?: boolean } = {},
): string | null {
  const route = value?.trim() ?? "";
  if (!route) return null;
  const normalized = route.toLowerCase();
  if (!dynamicOrderOnly && STATIC_NOTIFICATION_ROUTES.has(normalized)) return normalized;

  const statusAllowed = (parts: string[]) =>
    parts.length === 2 ||
    ACTIVE_ORDER_ROUTE_STATUSES.has(parts[2].trim().toLowerCase()) ||
    TERMINAL_ORDER_ROUTE_STATUSES.has(parts[2].trim().toLowerCase());

  const consumerTarget = parseConsumerOrderNotificationRoute(route);
  if (consumerTarget && NOTIFICATION_ORDER_ID.test(consumerTarget.orderId) && statusAllowed(route.split(":"))) {
    return route;
  }

  const merchantTarget = parseMerchantOrderNotificationRoute(route);
  if (merchantTarget && NOTIFICATION_ORDER_ID.test(merchantTarget.orderId) && statusAllowed(route.split(":"))) {
    return route;
  }
  return null;
}
