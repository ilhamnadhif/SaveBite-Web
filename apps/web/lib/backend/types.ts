/**
 * The SaveBite data contract, ported from `lib/data/backend/backend.dart`.
 * Two implementations, exactly like the mobile app:
 *  - `SupabaseBackend` (Postgres + Storage + Auth + Edge Functions);
 *  - `FakeBackend` (in-memory sample data, only for the explicit demo mode).
 */
import type {
  AdminComplaint,
  AdminMerchant,
  AdminStats,
  AdminUser,
  AppNotification,
  Bag,
  BagFilter,
  BankAccount,
  Complaint,
  ComplaintCategory,
  ComplaintStatus,
  FavoriteStore,
  IncomingOrder,
  Merchant,
  MerchantBag,
  MerchantReview,
  MerchantStats,
  OrderRecord,
  PayoutRequest,
  Profile,
  StoreProfile,
  TransactionReport,
  TxRecord,
} from "../models";

export type BackendBucket = "bag" | "logo" | "avatar";

/**
 * A domain error that is safe to show. Implementations wrap technical/SQL
 * detail into an actionable Indonesian message.
 */
export class BackendException extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BackendException";
    this.code = code;
  }
}

export const isBackendException = (error: unknown): error is BackendException => error instanceof BackendException;

/** Non-secret business values also used by the database transaction RPCs. */
export type BusinessConfig = {
  readonly serviceFee: number;
  readonly merchantCommissionBps: number;
  readonly withdrawalFee: number;
  readonly minimumWithdrawal: number;
  readonly paymentsEnabled: boolean;
  readonly payoutsEnabled: boolean;
};

export const DEFAULT_BUSINESS_CONFIG: BusinessConfig = Object.freeze({
  serviceFee: 1000,
  merchantCommissionBps: 1000,
  withdrawalFee: 2500,
  minimumWithdrawal: 50000,
  paymentsEnabled: false,
  payoutsEnabled: false,
});

/** `BusinessConfig.fromMap`. */
export function businessConfigFromMap(map: Record<string, unknown>): BusinessConfig {
  const positive = (key: string, fallback: number) => {
    const raw = map[key];
    const value = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : null;
    return value === null || value < 0 ? fallback : value;
  };
  return {
    serviceFee: positive("service_fee", 1000),
    merchantCommissionBps: Math.min(10000, Math.max(0, positive("merchant_commission_bps", 1000))),
    withdrawalFee: positive("withdrawal_fee", 2500),
    minimumWithdrawal: positive("minimum_withdrawal", 50000),
    paymentsEnabled: map.payments_enabled === true,
    payoutsEnabled: map.payouts_enabled === true,
  };
}

export type Unsubscribe = () => void;

export type BagInput = {
  title: string;
  salePrice: number;
  pickupWindow: string;
  total: number;
  description: string;
  contents: readonly string[];
  originalPrice: number;
  imageUrl?: string | null;
  availableOn?: Date | null;
  pickupStartsAt?: Date | null;
  pickupEndsAt?: Date | null;
};

export type StoreInput = {
  name: string;
  category: string;
  address: string;
  open: string;
  close: string;
  description?: string;
  logoUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export interface Backend {
  readonly isRemote: boolean;

  /** Clears every user-scoped cache when the session changes. */
  clearSessionCache(): void;

  businessConfig(): Promise<BusinessConfig>;

  // ── Profil konsumen ──
  currentProfile(): Promise<Profile | null>;
  updateProfile(fields: { name?: string; email?: string; phone?: string; avatarUrl?: string }): Promise<void>;
  setLastMode(mode: string): Promise<void>;

  // ── Browse konsumen ──
  nearbyBags(options: { latitude?: number | null; longitude?: number | null; filter?: BagFilter }): Promise<Bag[]>;
  searchBags(
    query: string,
    options: { latitude?: number | null; longitude?: number | null; filter?: BagFilter },
  ): Promise<Bag[]>;
  bagsByMerchant(merchantId: string): Promise<Bag[]>;
  /** Web deep links: one available bag, or null when it is gone. */
  bagById(bagId: string): Promise<Bag | null>;
  /** Web deep links: one public store, or null. */
  merchantById(merchantId: string): Promise<Merchant | null>;

  // ── Favorit ──
  favoriteMerchantIds(): Promise<Set<string>>;
  toggleFavorite(merchantId: string): Promise<boolean>;
  favoriteStores(): Promise<FavoriteStore[]>;

  // ── Pesanan konsumen ──
  placeOrder(bag: Bag, quantity: number, method: string, idempotencyKey: string): Promise<OrderRecord>;
  /**
   * Asks the backend to sync the payment status from the provider. The
   * client is never trusted to mark an order as paid.
   */
  refreshPayment(order: OrderRecord): Promise<OrderRecord>;
  activeOrders(): Promise<OrderRecord[]>;
  orderHistory(): Promise<OrderRecord[]>;
  issuePickupToken(order: OrderRecord): Promise<OrderRecord>;
  submitReview(order: OrderRecord, rating: number, tags: string[], comment: string): Promise<void>;

  // ── Pengaduan ──
  myComplaints(): Promise<Complaint[]>;
  submitComplaint(order: OrderRecord, category: ComplaintCategory, description: string): Promise<Complaint>;

  // ── Admin ──
  /** Best effort at startup; every admin RPC still checks the role itself. */
  isAdmin(): Promise<boolean>;
  adminStats(): Promise<AdminStats>;
  adminMerchants(): Promise<AdminMerchant[]>;
  setMerchantVerification(merchantId: string, status: "verified" | "rejected", note?: string): Promise<void>;
  adminUsers(search?: string): Promise<AdminUser[]>;
  setUserSuspended(userId: string, suspended: boolean, reason?: string): Promise<void>;
  adminComplaints(): Promise<AdminComplaint[]>;
  updateComplaint(complaintId: string, status: Exclude<ComplaintStatus, "open">, note?: string): Promise<void>;
  /** `from` and `to` are `YYYY-MM-DD` in Asia/Jakarta. */
  transactionReport(from: string, to: string): Promise<TransactionReport>;

  // ── Notifikasi ──
  notifications(): Promise<AppNotification[]>;
  markAllNotificationsRead(): Promise<void>;
  watchNotifications(onData: (values: AppNotification[]) => void, onError: (error: unknown) => void): Unsubscribe;

  // ── Toko (merchant) ──
  myStore(): Promise<StoreProfile | null>;
  upsertStore(input: StoreInput): Promise<void>;

  // ── Bag merchant ──
  myBags(): Promise<MerchantBag[]>;
  addBag(input: BagInput): Promise<void>;
  updateBag(bag: MerchantBag, input: BagInput): Promise<void>;
  setBagActive(bag: MerchantBag, active: boolean): Promise<void>;
  duplicateBag(bag: MerchantBag): Promise<void>;

  // ── Order masuk + statistik ──
  incomingOrders(): Promise<IncomingOrder[]>;
  watchIncomingOrders(onData: (values: IncomingOrder[]) => void, onError: (error: unknown) => void): Unsubscribe;
  markOrderReady(orderId: string): Promise<void>;
  cancelMerchantOrder(orderId: string): Promise<IncomingOrder>;
  redeemOrder(pickupToken: string): Promise<IncomingOrder | null>;
  merchantReviews(): Promise<MerchantReview[]>;
  merchantStats(): Promise<MerchantStats>;

  // ── Saldo ──
  balance(): Promise<number>;
  transactions(): Promise<TxRecord[]>;
  watchTransactions(onData: (values: TxRecord[]) => void, onError: (error: unknown) => void): Unsubscribe;
  bankAccounts(): Promise<BankAccount[]>;
  setDefaultBankAccount(bankAccountId: string): Promise<void>;
  saveBankAccount(input: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountHolder: string;
    idempotencyKey: string;
  }): Promise<BankAccount>;
  payoutRequests(): Promise<PayoutRequest[]>;
  requestPayout(input: { amount: number; bankAccountId: string; idempotencyKey: string }): Promise<PayoutRequest>;

  // ── Privasi akun ──
  deleteAccount(): Promise<void>;

  // ── Storage ──
  /**
   * Opens the image picker and uploads the selection; resolves the public URL
   * or null when cancelled. Must be called from a user gesture.
   */
  uploadImage(bucket: BackendBucket): Promise<string | null>;
  /** Uploads already-selected bytes with the same validation as `uploadImage`. */
  uploadImageBytes(bucket: BackendBucket, bytes: Uint8Array, filename: string): Promise<string | null>;
}
