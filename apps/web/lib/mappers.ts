/**
 * Supabase row → model conversion, ported from `lib/data/mappers.dart`.
 * Only the Supabase backend uses these.
 */
import { C } from "../ui/theme";
import { whitelistedNotificationRoute } from "./notificationRoute";
import {
  FALLBACK_IMAGE,
  incomingOrder,
  orderRecord,
  type AppNotification,
  type Bag,
  type BankAccount,
  type BankAccountStatus,
  type IncomingOrder,
  type IncomingOrderStatus,
  type Merchant,
  type MerchantBag,
  type MerchantReview,
  type NotifType,
  type OrderRecord,
  type OrderStatus,
  type PaymentState,
  type PayoutRequest,
  type PayoutStatus,
  type Profile,
  type StoreProfile,
  type TxKind,
  type TxRecord,
} from "./models";

export type Row = Record<string, unknown>;

const AVATAR_PALETTE = [C.amberAvatar, C.greenBright, C.terracotta, C.greenAccent, C.brown, C.bca, C.ovo, C.green];

/** Stable string hash (Dart's `hashCode` differs per platform, so any stable one will do). */
function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function initialOf(name: string | null | undefined): string {
  const value = (name ?? "").trim();
  return value ? value[0].toUpperCase() : "?";
}

export function initials2(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/);
  if (!parts.length || !parts[0]) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Dart `'${open ?? '08.00'}–${close ?? '21.00'}'`: only null falls back. */
const hoursOf = (open: unknown, close: unknown) =>
  `${open === null || open === undefined ? "08.00" : str(open)}–${close === null || close === undefined ? "21.00" : str(close)}`;

function asInt(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === "string" && /^\s*[-+]?\d+\s*$/.test(value)) return Number.parseInt(value, 10);
  return 0;
}

function asDouble(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(value) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Dart `DateTime.tryParse(...)?.toLocal()`. Date-only and offset-less values
 * are local time in Dart; JavaScript would read `YYYY-MM-DD` as UTC.
 */
export function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = str(value).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text.includes(" ") && !text.includes("T") ? text.replace(" ", "T") : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asMap(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => str(item)) : [];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "Hari ini" or "4 Okt". */
export function dateLabel(value: unknown): string {
  const date = parseDate(value);
  if (!date) return "";
  const now = new Date();
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
    return "Hari ini";
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "08.30". */
export function timeLabel(value: unknown): string {
  const date = parseDate(value);
  if (!date) return "";
  return `${String(date.getHours()).padStart(2, "0")}.${String(date.getMinutes()).padStart(2, "0")}`;
}

function notifType(value: unknown): NotifType {
  switch (str(value)) {
    case "ready":
      return "ready";
    case "newBag":
      return "newBag";
    case "rating":
      return "rating";
    default:
      return "payment";
  }
}

const fallbackCode = (id: string) => `SB-${id.replace(/-/g, "").toUpperCase().padEnd(8, "0").slice(0, 8)}`;

export function merchantFromMap(m: Row): Merchant {
  const id = str(m.merchant_id ?? m.id);
  const name = str(m.store_name ?? m.merchant_name);
  const logo = str(m.logo_url ?? m.merchant_logo_url);
  const lat = m.lat ?? m.merchant_lat;
  const lng = m.lng ?? m.merchant_lng;
  return {
    id,
    name: name || "Toko",
    initial: initialOf(name),
    avatarColor: AVATAR_PALETTE[stableHash(id) % AVATAR_PALETTE.length],
    category: str(m.category ?? m.merchant_category),
    rating: asDouble(m.rating ?? m.merchant_rating),
    reviewCount: asInt(m.review_count ?? m.merchant_review_count),
    distance: str(m.distance ?? m.merchant_distance),
    address: str(m.address ?? m.merchant_address),
    hours: hoursOf(m.open_time ?? m.merchant_open_time, m.close_time ?? m.merchant_close_time),
    coverImage: logo || FALLBACK_IMAGE,
    bagsSaved: asInt(m.bags_saved ?? m.merchant_bags_saved),
    latitude: lat === null || lat === undefined ? null : asDouble(lat),
    longitude: lng === null || lng === undefined ? null : asDouble(lng),
  };
}

export function bagFromMap(m: Row, merchant?: Merchant): Bag {
  const nested = asMap(m.merchants) ?? asMap(m.merchant);
  const owner = merchant ?? merchantFromMap(nested ?? m);
  const quantityLeft = asInt(m.quantity_left);
  const image = str(m.image_url);
  const salePrice = asInt(m.sale_price ?? m.unit_price);
  const originalPrice = asInt(m.original_price);
  return {
    id: str(m.bag_id ?? m.id),
    merchant: owner,
    title: str(m.title ?? m.bag_title),
    description: str(m.description ?? m.bag_description),
    originalPrice: originalPrice > 0 ? originalPrice : asInt(m.original_price_snapshot ?? salePrice * 3),
    salePrice,
    quantityLeft,
    quantityTotal: asInt(m.quantity_total ?? m.quantity),
    pickupWindow: str(m.pickup_window ?? m.pickup_window_snapshot),
    image: image || str(m.bag_image_url) || FALLBACK_IMAGE,
    contents: asStringList(m.contents),
    soldOut: str(m.status) === "sold_out" || quantityLeft <= 0,
    availableOn: parseDate(m.available_on),
    pickupStartsAt: parseDate(m.pickup_start_at),
    pickupEndsAt: parseDate(m.pickup_end_at),
  };
}

export function merchantBagFromMap(m: Row): MerchantBag {
  const total = asInt(m.quantity_total);
  const left = asInt(m.quantity_left);
  const image = str(m.image_url);
  const status = str(m.status);
  return {
    id: str(m.id),
    title: str(m.title),
    salePrice: asInt(m.sale_price),
    pickupWindow: str(m.pickup_window) || "—",
    sold: total - left,
    total,
    image: image || FALLBACK_IMAGE,
    active: status === "active",
    statusNote: status === "sold_out" ? "Habis terjual" : null,
    description: str(m.description),
    contents: asStringList(m.contents),
    originalPrice: asInt(m.original_price),
    quantityLeft: left,
    availableOn: parseDate(m.available_on),
    pickupStartsAt: parseDate(m.pickup_start_at),
    pickupEndsAt: parseDate(m.pickup_end_at),
  };
}

function orderStatusOf(value: string): OrderStatus {
  switch (value) {
    case "ready":
      return "ready";
    case "redeemed":
      return "done";
    case "cancelled":
    case "refunded":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      // pending, paid, preparing, and unknown values.
      return "pending";
  }
}

function paymentStateOf(m: Row): PaymentState {
  const raw = str(m.payment_status).toLowerCase();
  const fraud = str(m.fraud_status).toLowerCase();
  switch (raw) {
    case "creating":
    case "checkout_created":
    case "new":
      return "awaitingPayment";
    case "pending":
      return "pending";
    case "capture":
      return fraud === "accept" ? "paid" : fraud === "deny" ? "failed" : "pending";
    case "settlement":
    case "paid":
      return "paid";
    case "deny":
    case "failure":
    case "failed":
      return "failed";
    case "cancel":
    case "cancelled":
      return "cancelled";
    case "expire":
    case "expired":
      return "expired";
    case "refund":
    case "refunded":
      return "refunded";
    case "partial_refund":
    case "chargeback":
    case "partial_chargeback":
    case "disputed":
      return "disputed";
    default:
      // Legacy orders without payment_status may rely on the payment
      // timestamp. Unknown provider states always fail closed.
      return raw === "" && (m.payment_verified_at != null || m.paid_at != null) ? "paid" : "awaitingPayment";
  }
}

const optional = (value: unknown) => str(value) || null;

export function orderRecordFromMap(m: Row): OrderRecord {
  const nested = asMap(m.surprise_bags) ?? asMap(m.bag);
  const bag = bagFromMap(nested ?? m);
  const status = orderStatusOf(str(m.status));
  const subtotal = asInt(m.subtotal ?? m.subtotal_amount);
  const fee = asInt(m.service_fee);
  const amount = asInt(m.total_amount);
  const id = str(m.order_id ?? m.id);
  const reviewed = m.reviewed === true || (m.review_id !== null && m.review_id !== undefined);
  const quantity = asInt(m.quantity);
  return orderRecord({
    id,
    bag,
    code: str(m.order_reference) || fallbackCode(id),
    dateLabel: dateLabel(m.created_at),
    amount,
    status,
    reviewed,
    quantity: quantity === 0 ? 1 : quantity,
    paymentMethod: str(m.payment_method) || "QRIS",
    canRate: status === "done" && m.reviewed !== true && (m.review_id === null || m.review_id === undefined),
    createdAt: parseDate(m.created_at),
    pickupStartsAt: parseDate(m.pickup_start_at),
    expiresAt: parseDate(m.expires_at ?? m.pickup_end_at),
    redeemedAt: parseDate(m.redeemed_at),
    subtotalAmount: subtotal > 0 ? subtotal : amount - fee,
    serviceFee: fee,
    merchantNetAmount: asInt(m.merchant_net_amount),
    pickupToken: optional(m.pickup_token),
    paymentState: paymentStateOf(m),
    paymentQrUrl: optional(m.payment_qr_url),
    paymentSnapToken: optional(m.payment_snap_token),
    simulatorQrImageUrl: optional(m.simulator_qr_image_url),
    paymentRedirectUrl: optional(m.payment_redirect_url),
    paymentExpiresAt: parseDate(m.payment_expires_at),
    providerPaymentType: optional(m.payment_type),
    providerOrderId: optional(m.midtrans_order_id),
  });
}

function incomingStatusOf(value: string): IncomingOrderStatus {
  switch (value) {
    case "paid":
      return "paid";
    case "preparing":
      return "preparing";
    case "ready":
      return "ready";
    case "redeemed":
      return "redeemed";
    case "cancelled":
    case "refunded":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      // New or unknown values must never become a paid, actionable order.
      return "pending";
  }
}

export function incomingOrderFromMap(m: Row): IncomingOrder {
  const profile = asMap(m.profiles);
  const raw = str(m.consumer_name) || str(profile?.name);
  const name = raw || "Pelanggan";
  const status = incomingStatusOf(str(m.status));
  const image = str(m.bag_image_url ?? m.image_url);
  const id = str(m.order_id ?? m.id);
  const quantity = asInt(m.quantity);
  return incomingOrder({
    id,
    customer: name,
    initial: initials2(name),
    time: timeLabel(m.created_at),
    bags: quantity === 0 ? 1 : quantity,
    code: str(m.order_reference) || fallbackCode(id),
    needsAction: status === "paid" || status === "preparing",
    redeemed: status === "redeemed",
    status,
    bagTitle: str(m.bag_title ?? m.title),
    bagImage: image || FALLBACK_IMAGE,
    pickupWindow: str(m.pickup_window ?? m.pickup_window_snapshot),
    unitPrice: asInt(m.unit_price ?? m.sale_price),
    subtotalAmount: asInt(m.subtotal ?? m.subtotal_amount),
    serviceFee: asInt(m.service_fee),
    merchantNetAmount: asInt(m.merchant_net_amount),
    createdAt: parseDate(m.created_at),
    pickupStartsAt: parseDate(m.pickup_start_at),
    expiresAt: parseDate(m.expires_at ?? m.pickup_end_at),
    redeemedAt: parseDate(m.redeemed_at),
  });
}

export function merchantReviewFromMap(m: Row): MerchantReview {
  const name = str(m.customer_name ?? m.consumer_name);
  return {
    id: str(m.review_id ?? m.id),
    orderId: str(m.order_id),
    orderReference: str(m.order_reference) || "Pesanan",
    customerName: name || "Pelanggan",
    rating: Math.min(5, Math.max(1, asInt(m.rating))),
    tags: asStringList(m.tags).filter((tag) => tag.trim()),
    comment: str(m.comment),
    createdAt: parseDate(m.created_at),
  };
}

export function notificationFromMap(m: Row): AppNotification {
  const data = asMap(m.data);
  let route =
    whitelistedNotificationRoute(str(m.route)) ??
    whitelistedNotificationRoute(str(data?.route)) ??
    whitelistedNotificationRoute(str(m.dedupe_key), { dynamicOrderOnly: true }) ??
    "";
  if (!route) {
    switch (str(m.entity_type)) {
      case "order":
        route = str(m.title).toLowerCase().includes("pesanan baru") ? "merchant_orders" : "orders";
        break;
      case "review":
        route = "merchant_reviews";
        break;
      case "payout":
      case "bank_account":
        route = "merchant_balance";
        break;
      case "bag":
        route = "consumer_home";
        break;
      default:
        route = "";
    }
  }
  return {
    id: str(m.id),
    title: str(m.title),
    body: str(m.body),
    time: timeLabel(m.created_at),
    type: notifType(m.type),
    group: str(m.group_label) || "Hari ini",
    unread: m.read !== true,
    route: route || null,
    createdAt: parseDate(m.created_at),
  };
}

export function txFromMap(m: Row): TxRecord {
  const kind: TxKind = str(m.kind) === "withdrawal" ? "withdrawal" : str(m.kind) === "withdrawal_reversal" ? "reversal" : "income";
  return {
    id: str(m.id),
    title: str(m.title),
    subtitle: str(m.subtitle),
    amount: asInt(m.amount),
    kind,
    createdAt: parseDate(m.created_at),
    status: str(m.status) || "completed",
  };
}

export function profileFromMap(m: Row): Profile {
  return {
    id: str(m.id),
    name: str(m.name) || "Pengguna",
    email: str(m.email),
    phone: str(m.phone),
    avatarUrl: optional(m.avatar_url),
    lastMode: str(m.last_mode) || "consumer",
  };
}

export function storeFromMap(m: Row): StoreProfile {
  return {
    id: str(m.id),
    name: str(m.store_name),
    category: str(m.category) || "Bakery",
    address: str(m.address),
    openTime: str(m.open_time) || "08.00",
    closeTime: str(m.close_time) || "21.00",
    description: str(m.description),
    logoUrl: optional(m.logo_url),
    latitude: m.lat === null || m.lat === undefined ? null : asDouble(m.lat),
    longitude: m.lng === null || m.lng === undefined ? null : asDouble(m.lng),
  };
}

function bankDisplayName(code: string, rawName: string): string {
  if (rawName && rawName.toUpperCase() !== code) return rawName;
  switch (code) {
    case "BCA":
      return "BCA";
    case "MANDIRI":
      return "Bank Mandiri";
    case "BNI":
      return "BNI";
    case "BRI":
      return "BRI";
    case "BSI":
      return "Bank Syariah Indonesia";
    case "PERMATA":
      return "Bank Permata";
    case "CIMB":
      return "CIMB Niaga";
    default:
      return rawName || code;
  }
}

export function bankAccountFromMap(m: Row): BankAccount {
  const code = str(m.bank_code).toUpperCase();
  const rawName = str(m.bank_name).trim();
  const last4 = str(m.account_number_last4);
  const masked = str(m.account_number_masked);
  let status: BankAccountStatus;
  switch (str(m.status)) {
    case "verified":
      status = "verified";
      break;
    case "rejected":
      status = "rejected";
      break;
    case "disabled":
      status = "disabled";
      break;
    default:
      status = m.verified === true ? "verified" : "pending";
  }
  return {
    id: str(m.id ?? m.bank_account_id),
    bankCode: code,
    bankName: bankDisplayName(code, rawName),
    accountNumberMasked: masked || (last4 ? `•••• ${last4}` : "••••"),
    accountHolder: str(m.account_holder),
    status,
    isDefault: m.is_default === true,
  };
}

export function payoutRequestFromMap(m: Row, bankAccount?: BankAccount | null): PayoutRequest {
  const nested = asMap(m.bank_accounts) ?? asMap(m.bank_account);
  const account =
    bankAccount ??
    bankAccountFromMap(
      nested ?? {
        id: m.bank_account_id,
        bank_code: m.bank_code,
        bank_name: m.bank_name,
        account_number_last4: m.account_number_last4,
        account_holder: m.account_holder,
        status: "verified",
      },
    );
  const statusRaw = str(m.status);
  const status: PayoutStatus =
    statusRaw === "processing" || statusRaw === "paid" || statusRaw === "failed" || statusRaw === "cancelled" ? statusRaw : "pending";
  const gross = asInt(m.gross_amount ?? m.amount);
  const fee = asInt(m.fee_amount);
  const net = asInt(m.net_amount);
  return {
    id: str(m.id ?? m.payout_request_id),
    grossAmount: gross,
    feeAmount: fee,
    netAmount: net > 0 ? net : gross - fee,
    status,
    bankAccount: account,
    createdAt: parseDate(m.created_at ?? m.requested_at),
  };
}
