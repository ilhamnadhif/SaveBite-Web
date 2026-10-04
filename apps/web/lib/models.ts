/**
 * Domain models, ported from the Flutter app's `lib/data/models.dart`.
 *
 * Dart classes become plain readonly object types. Computed getters become
 * helper functions (`discountPercent(bag)`), `copyWith` becomes an object
 * spread, enums become string unions, `DateTime?` becomes `Date | null`, and
 * `TimeOfDay` becomes `{ hour, minute }`.
 */

/** Formats a whole-rupiah amount like Flutter's `formatRupiah`: 15000 → "Rp15.000". */
export function formatRupiah(value: number): string {
  const rounded = Math.trunc(Number.isFinite(value) ? value : 0);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ".";
    out += digits[i];
  }
  return `${negative ? "-" : ""}Rp${out}`;
}

/** Trims items and drops case-insensitive duplicates, keeping first order. */
export function normalizeBagContents(values: Iterable<string>): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = value.trim();
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    normalized.push(item);
  }
  return normalized;
}

/** Merchants may separate contents with commas, semicolons, or new lines. */
export function parseBagContents(text: string): string[] {
  return normalizeBagContents(text.split(/[,;\r\n]+/));
}

/** Domain validation message shared by forms and the demo backend. */
export function bagContentsValidationError(values: Iterable<string>): string | null {
  const normalized = normalizeBagContents(values);
  if (normalized.length > 20) return "Maksimal 20 item";
  if (normalized.some((item) => item.length > 80)) return "Setiap item maksimal 80 karakter";
  return null;
}

export type Merchant = {
  readonly id: string;
  readonly name: string;
  readonly initial: string;
  readonly avatarColor: string;
  readonly category: string;
  readonly rating: number;
  readonly reviewCount: number;
  readonly distance: string;
  readonly address: string;
  readonly hours: string;
  readonly coverImage: string;
  readonly bagsSaved: number;
  readonly latitude: number | null;
  readonly longitude: number | null;
};

export type Bag = {
  readonly id: string;
  readonly merchant: Merchant;
  readonly title: string;
  readonly description: string;
  readonly originalPrice: number;
  readonly salePrice: number;
  readonly quantityLeft: number;
  readonly quantityTotal: number;
  readonly pickupWindow: string;
  readonly image: string;
  readonly contents: readonly string[];
  readonly soldOut: boolean;
  readonly availableOn: Date | null;
  readonly pickupStartsAt: Date | null;
  readonly pickupEndsAt: Date | null;
};

/** Dart `bag.discountPercent`. */
export function discountPercent(bag: Pick<Bag, "originalPrice" | "salePrice">): number {
  if (bag.originalPrice <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (1 - bag.salePrice / bag.originalPrice) * 100)));
}

/** Dart `bag.savings`. */
export function savings(bag: Pick<Bag, "originalPrice" | "salePrice">): number {
  return Math.min(bag.originalPrice, Math.max(0, bag.originalPrice - bag.salePrice));
}

export type OrderStatus = "pending" | "ready" | "done" | "cancelled" | "expired";

/**
 * Payment status is separate from fulfilment. An order can be paid yet still
 * `pending` because the merchant has not prepared it.
 */
export type PaymentState =
  | "awaitingPayment"
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "refunded"
  | "disputed";

export const isPaid = (state: PaymentState) => state === "paid";
export const isAwaitingCustomer = (state: PaymentState) => state === "awaitingPayment" || state === "pending";
export const isTerminalFailure = (state: PaymentState) =>
  state === "failed" || state === "cancelled" || state === "expired" || state === "refunded" || state === "disputed";

export type OrderRecord = {
  readonly id: string;
  readonly bag: Bag;
  readonly code: string;
  readonly dateLabel: string;
  readonly amount: number;
  readonly status: OrderStatus;
  readonly reviewed: boolean;
  readonly canRate: boolean;
  readonly quantity: number;
  readonly paymentMethod: string;
  readonly createdAt: Date | null;
  readonly pickupStartsAt: Date | null;
  readonly expiresAt: Date | null;
  readonly redeemedAt: Date | null;
  readonly subtotalAmount: number;
  readonly serviceFee: number;
  readonly merchantNetAmount: number;
  readonly pickupToken: string | null;
  readonly paymentState: PaymentState;
  readonly paymentQrUrl: string | null;
  readonly paymentSnapToken: string | null;
  readonly simulatorQrImageUrl: string | null;
  /** Snap checkout URL (mobile WebView). The web opens Snap.js with the token. */
  readonly paymentRedirectUrl: string | null;
  readonly paymentExpiresAt: Date | null;
  readonly providerPaymentType: string | null;
  readonly providerOrderId: string | null;
};

/** Builds an `OrderRecord` with the same defaults as the Dart constructor. */
export function orderRecord(
  fields: Pick<OrderRecord, "bag" | "code" | "dateLabel" | "amount" | "status"> & Partial<OrderRecord>,
): OrderRecord {
  return {
    id: "",
    reviewed: false,
    canRate: false,
    quantity: 1,
    paymentMethod: "QRIS",
    createdAt: null,
    pickupStartsAt: null,
    expiresAt: null,
    redeemedAt: null,
    subtotalAmount: 0,
    serviceFee: 0,
    merchantNetAmount: 0,
    pickupToken: null,
    paymentState: "paid",
    paymentQrUrl: null,
    paymentSnapToken: null,
    simulatorQrImageUrl: null,
    paymentRedirectUrl: null,
    paymentExpiresAt: null,
    providerPaymentType: null,
    providerOrderId: null,
    ...fields,
  };
}

export type NotifType = "ready" | "newBag" | "rating" | "payment";

export type AppNotification = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly time: string;
  readonly type: NotifType;
  readonly unread: boolean;
  readonly group: string;
  readonly route: string | null;
  readonly createdAt: Date | null;
};

export type FavoriteStore = {
  readonly merchant: Merchant;
  /** "3 bag tersedia" / "Habis hari ini". */
  readonly availability: string;
  readonly soldOut: boolean;
};

export type TxKind = "income" | "withdrawal" | "reversal";

export type TxRecord = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  /** Positive = in; shown according to `kind`. */
  readonly amount: number;
  readonly kind: TxKind;
  readonly createdAt: Date | null;
  readonly status: string;
};

/** A merchant's own bag (Kelola Bag & Dashboard). */
export type MerchantBag = {
  readonly id: string;
  readonly title: string;
  readonly salePrice: number;
  readonly pickupWindow: string;
  readonly sold: number;
  readonly total: number;
  readonly image: string;
  readonly active: boolean;
  /** e.g. "Habis terjual". */
  readonly statusNote: string | null;
  readonly description: string;
  readonly contents: readonly string[];
  readonly originalPrice: number;
  readonly quantityLeft: number;
  readonly availableOn: Date | null;
  readonly pickupStartsAt: Date | null;
  readonly pickupEndsAt: Date | null;
};

/** Builds a `MerchantBag` with the Dart defaults (`quantityLeft = total - sold`). */
export function merchantBag(
  fields: Pick<MerchantBag, "id" | "title" | "salePrice" | "pickupWindow" | "sold" | "total" | "image" | "active"> &
    Partial<MerchantBag>,
): MerchantBag {
  return {
    statusNote: null,
    description: "",
    contents: [],
    originalPrice: 0,
    quantityLeft: fields.total - fields.sold,
    availableOn: null,
    pickupStartsAt: null,
    pickupEndsAt: null,
    ...fields,
  };
}

export type IncomingOrderStatus = "pending" | "paid" | "preparing" | "ready" | "redeemed" | "cancelled" | "expired";

export type IncomingOrder = {
  readonly id: string;
  readonly customer: string;
  readonly initial: string;
  readonly time: string;
  readonly bags: number;
  readonly code: string;
  /** Needs preparing. */
  readonly needsAction: boolean;
  readonly redeemed: boolean;
  readonly status: IncomingOrderStatus;
  readonly bagTitle: string;
  readonly bagImage: string;
  readonly pickupWindow: string;
  readonly unitPrice: number;
  readonly subtotalAmount: number;
  readonly serviceFee: number;
  readonly merchantNetAmount: number;
  readonly createdAt: Date | null;
  readonly pickupStartsAt: Date | null;
  readonly expiresAt: Date | null;
  readonly redeemedAt: Date | null;
};

/** Builds an `IncomingOrder` with the Dart defaults. */
export function incomingOrder(
  fields: Pick<IncomingOrder, "customer" | "initial" | "time" | "bags" | "code"> &
    Partial<Omit<IncomingOrder, "status">> & { status?: IncomingOrderStatus | null },
): IncomingOrder {
  const redeemed = fields.redeemed ?? false;
  return {
    id: "",
    needsAction: true,
    bagTitle: "",
    bagImage: "",
    pickupWindow: "",
    unitPrice: 0,
    subtotalAmount: 0,
    serviceFee: 0,
    merchantNetAmount: 0,
    createdAt: null,
    pickupStartsAt: null,
    expiresAt: null,
    redeemedAt: null,
    ...fields,
    redeemed,
    status: fields.status ?? (redeemed ? "redeemed" : "paid"),
  };
}

/** Dart `IncomingOrder.copyWith`: `redeemed: true` always wins the status. */
export function copyIncomingOrder(
  order: IncomingOrder,
  patch: { redeemed?: boolean; status?: IncomingOrderStatus; needsAction?: boolean; redeemedAt?: Date | null },
): IncomingOrder {
  const redeemed = patch.redeemed ?? order.redeemed;
  return {
    ...order,
    needsAction: patch.needsAction ?? order.needsAction,
    redeemed,
    status: redeemed ? "redeemed" : (patch.status ?? order.status),
    redeemedAt: patch.redeemedAt ?? order.redeemedAt,
  };
}

/**
 * A review the merchant owning the order may read. Comes from a protected RPC
 * and carries no consumer contact details.
 */
export type MerchantReview = {
  readonly id: string;
  readonly orderId: string;
  readonly orderReference: string;
  readonly customerName: string;
  readonly rating: number;
  readonly tags: readonly string[];
  readonly comment: string;
  readonly createdAt: Date | null;
};

/** Dart `MerchantReview.customerInitial`. */
export function customerInitial(review: Pick<MerchantReview, "customerName">): string {
  const parts = review.customerName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export type TimeOfDay = { readonly hour: number; readonly minute: number };

export type BagFilter = {
  readonly categories: ReadonlySet<string>;
  readonly maxDistanceKm: number | null;
  readonly minPrice: number | null;
  readonly maxPrice: number | null;
  readonly pickupAfter: TimeOfDay | null;
  readonly pickupBefore: TimeOfDay | null;
};

export const EMPTY_FILTER: BagFilter = Object.freeze({
  categories: new Set<string>(),
  maxDistanceKm: null,
  minPrice: null,
  maxPrice: null,
  pickupAfter: null,
  pickupBefore: null,
});

export function isFilterEmpty(filter: BagFilter): boolean {
  return (
    filter.categories.size === 0 &&
    filter.maxDistanceKm === null &&
    filter.minPrice === null &&
    filter.maxPrice === null &&
    filter.pickupAfter === null &&
    filter.pickupBefore === null
  );
}

/**
 * One filter rule shared by the preview, the demo backend, and Supabase, so the
 * number of results does not change after "Terapkan" is pressed.
 */
export function bagMatchesFilter(bag: Bag, filter: BagFilter): boolean {
  if (bag.soldOut || bag.quantityLeft <= 0) return false;
  if (filter.categories.size > 0) {
    const category = bag.merchant.category.toLowerCase();
    if (![...filter.categories].some((value) => value.toLowerCase() === category)) return false;
  }
  if (filter.minPrice !== null && bag.salePrice < filter.minPrice) return false;
  if (filter.maxPrice !== null && bag.salePrice > filter.maxPrice) return false;

  if (filter.maxDistanceKm !== null) {
    const match = /([0-9]+(?:[,.][0-9]+)?)/.exec(bag.merchant.distance);
    const distance = match ? Number.parseFloat(match[1].replace(",", ".")) : Number.NaN;
    if (!Number.isFinite(distance) || distance > filter.maxDistanceKm) return false;
  }

  if (filter.pickupAfter !== null || filter.pickupBefore !== null) {
    const window = bagPickupMinutes(bag);
    if (!window) return false;
    const after = filter.pickupAfter;
    const before = filter.pickupBefore;
    // A bag matches when its pickup window overlaps the filter range.
    if (after && window[1] < after.hour * 60 + after.minute) return false;
    if (before && window[0] > before.hour * 60 + before.minute) return false;
  }
  return true;
}

function bagPickupMinutes(bag: Bag): [number, number] | null {
  const starts = bag.pickupStartsAt;
  const ends = bag.pickupEndsAt;
  if (starts && ends) {
    return [starts.getHours() * 60 + starts.getMinutes(), ends.getHours() * 60 + ends.getMinutes()];
  }
  const match = /(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})/.exec(bag.pickupWindow);
  if (!match) return null;
  const [startHour, startMinute, endHour, endMinute] = match.slice(1, 5).map((value) => Number.parseInt(value, 10));
  if (
    [startHour, startMinute, endHour, endMinute].some((value) => !Number.isFinite(value)) ||
    startHour > 23 ||
    endHour > 23 ||
    startMinute > 59 ||
    endMinute > 59
  ) {
    return null;
  }
  return [startHour * 60 + startMinute, endHour * 60 + endMinute];
}

export type BankAccountStatus = "pending" | "verified" | "rejected" | "disabled";

export type BankAccount = {
  readonly id: string;
  readonly bankCode: string;
  readonly bankName: string;
  readonly accountNumberMasked: string;
  readonly accountHolder: string;
  readonly status: BankAccountStatus;
  readonly isDefault: boolean;
};

/** Dart `account.label`. */
export const bankLabel = (account: Pick<BankAccount, "bankName" | "accountNumberMasked">) =>
  `${account.bankName} · ${account.accountNumberMasked}`;

/** Dart `account.verified`. */
export const bankVerified = (account: Pick<BankAccount, "status">) => account.status === "verified";

export type PayoutStatus = "pending" | "processing" | "paid" | "failed" | "cancelled";

export type PayoutRequest = {
  readonly id: string;
  readonly grossAmount: number;
  readonly feeAmount: number;
  readonly netAmount: number;
  readonly status: PayoutStatus;
  readonly bankAccount: BankAccount;
  readonly createdAt: Date | null;
};

/** Consumer profile, from `profiles`. */
export type Profile = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly avatarUrl: string | null;
  /** "consumer" | "merchant". */
  readonly lastMode: string;
};

/** The merchant's store, from `merchants` (owned by the user). */
export type StoreProfile = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly address: string;
  readonly openTime: string;
  readonly closeTime: string;
  readonly description: string;
  readonly logoUrl: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
};

/** Merchant dashboard summary. */
export type MerchantStats = {
  readonly bagsSoldToday: number;
  readonly incomeToday: number;
  readonly activeBagCount: number;
  readonly pendingOrderCount: number;
  readonly incomeThisMonth: number;
  readonly foodSavedKg: number;
};

export const EMPTY_STATS: MerchantStats = Object.freeze({
  bagsSoldToday: 0,
  incomeToday: 0,
  activeBagCount: 0,
  pendingOrderCount: 0,
  incomeThisMonth: 0,
  foodSavedKg: 0,
});

/** Local fallback image, the Flutter `assets/images/food1.jpg`. */
export const FALLBACK_IMAGE = "/images/food1.jpg";

/** Maps a Flutter asset path (`assets/images/x.jpg`) to its web URL. */
export function assetUrl(path: string): string {
  if (path.startsWith("assets/images/")) return `/images/${path.slice("assets/images/".length)}`;
  return path;
}
