"use client";

/**
 * In-memory backend over `SampleData`, ported line by line from
 * `lib/data/backend/fake_backend.dart`. Used only for the explicit demo mode
 * (`NEXT_PUBLIC_SAVEBITE_DEMO=true`) and deterministic tests; a missing
 * production configuration never falls back to it. Every change lasts for the
 * session (until the page is reloaded).
 */
import { pickImageFile } from "../imagePicker";
import {
  EMPTY_FILTER,
  bagContentsValidationError,
  bagMatchesFilter,
  copyIncomingOrder,
  incomingOrder,
  normalizeBagContents,
  orderRecord,
  type AppNotification,
  type Bag,
  type BagFilter,
  type BankAccount,
  type FavoriteStore,
  type IncomingOrder,
  type Merchant,
  type MerchantBag,
  type MerchantReview,
  type MerchantStats,
  type OrderRecord,
  type PayoutRequest,
  type Profile,
  type StoreProfile,
  type TxRecord,
} from "../models";
import { SampleData } from "../sampleData";
import {
  BackendException,
  DEFAULT_BUSINESS_CONFIG,
  type Backend,
  type BackendBucket,
  type BagInput,
  type BusinessConfig,
  type StoreInput,
  type Unsubscribe,
} from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type Topic = "notifications" | "incoming" | "transactions";

type LocationOptions = { latitude?: number | null; longitude?: number | null; filter?: BagFilter };

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6371;
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Dart `double.tryParse`: the whole text must be a number ("0,4" is not). */
function tryParseDouble(text: string): number | null {
  const value = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return null;
  return Number(value);
}

/** Local midnight, like Dart's `DateTime(d.year, d.month, d.day)`. */
const dateOnly = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

export class FakeBackend implements Backend {
  readonly isRemote: boolean = false;

  async businessConfig(): Promise<BusinessConfig> {
    return DEFAULT_BUSINESS_CONFIG;
  }

  private seq = 100;
  private codeSeq = 1000;

  private nextId(prefix: string): string {
    return `${prefix}${this.seq++}`;
  }

  private nextCode(): string {
    return `SB-${(this.codeSeq++).toString(36).toUpperCase().padStart(5, "0")}`;
  }

  private nextToken(): string {
    return `savebite-pickup:${this.nextId("token-")}:${Date.now() * 1000}`;
  }

  private readonly ordersByIdempotencyKey = new Map<string, OrderRecord>();
  private readonly orderSignaturesByIdempotencyKey = new Map<string, string>();
  private readonly remainingStock = new Map<string, number>();
  private readonly pickupTokens = new Map<string, string>();
  private readonly pickupTokenExpiries = new Map<string, Date>();
  private readonly locallyPublishedBagIds = new Set<string>();
  private readonly changeListeners: Record<Topic, Set<() => void>> = {
    notifications: new Set(),
    incoming: new Set(),
    transactions: new Set(),
  };

  /** Dart `_xChanges.add(null)`: every watcher of the topic re-emits. */
  private changed(topic: Topic) {
    for (const listener of [...this.changeListeners[topic]]) listener();
  }

  /**
   * Dart `_watchSnapshots`: the current snapshot on subscribe, then a fresh
   * snapshot after every change. Like a Dart stream, values arrive
   * asynchronously, and nothing arrives after the subscription is cancelled
   * (logout/reset never keeps an old session's listener alive).
   */
  private watchSnapshots<T>(topic: Topic, snapshot: () => T[], onData: (values: T[]) => void): Unsubscribe {
    let listening = true;
    const initial = snapshot();
    queueMicrotask(() => {
      if (listening) onData(initial);
    });
    const listener = () =>
      queueMicrotask(() => {
        if (listening) onData(snapshot());
      });
    this.changeListeners[topic].add(listener);
    return () => {
      listening = false;
      this.changeListeners[topic].delete(listener);
    };
  }

  clearSessionCache(): void {
    this.ordersByIdempotencyKey.clear();
    this.orderSignaturesByIdempotencyKey.clear();
    this.pickupTokens.clear();
    this.pickupTokenExpiries.clear();
    for (let i = 0; i < this.active.length; i++) {
      if (this.active[i].pickupToken !== null) this.active[i] = { ...this.active[i], pickupToken: null };
    }
    this.bankByIdempotencyKey.clear();
    this.payoutByIdempotencyKey.clear();
  }

  // Profile & store (mutable)
  private profile: Profile = {
    id: "me",
    name: "Ilham Hidayat",
    email: "ilham@gmail.com",
    phone: "0812-3456-7890",
    avatarUrl: null,
    lastMode: "consumer",
  };
  // Starts null → a new merchant goes through Setup Toko first (PRD F-G4).
  private store: StoreProfile | null = null;

  private readonly favorites = new Set<string>(["m1", "m2", "m8"]);
  private readonly bags: MerchantBag[] = [...SampleData.merchantActiveBags, ...SampleData.merchantInactiveBags];
  private readonly active: OrderRecord[] = [...SampleData.activeOrders];
  private readonly history: OrderRecord[] = [...SampleData.orderHistory];
  private readonly incoming: IncomingOrder[] = [...SampleData.incomingOrders];
  private readonly reviews: MerchantReview[] = [
    {
      id: "review-merchant-1",
      orderId: "order-review-1",
      orderReference: "SB-8F4K2P",
      customerName: "Nadia Putri",
      rating: 5,
      tags: ["Masih fresh", "Porsi banyak"],
      comment: "Rotinya masih lembut dan isi bag-nya beragam. Terima kasih!",
      createdAt: new Date(Date.now() - 5 * HOUR_MS),
    },
    {
      id: "review-merchant-2",
      orderId: "order-review-2",
      orderReference: "SB-1Q7M9C",
      customerName: "Dimas Arya",
      rating: 4,
      tags: ["Sesuai deskripsi", "Pelayanan ramah"],
      comment: "Pengambilan cepat dan makanannya masih enak.",
      createdAt: new Date(Date.now() - 2 * DAY_MS),
    },
  ];
  private readonly notifs: AppNotification[] = [...SampleData.notifications];
  private readonly tx: TxRecord[] = [...SampleData.transactions];
  private balanceValue = SampleData.merchantBalance;
  private soldToday = 8;
  private incomeToday = 120000;

  private readonly bankAccountList: BankAccount[] = [
    {
      id: "bank-1",
      bankCode: "BCA",
      bankName: "BCA",
      accountNumberMasked: "•••• 6789",
      accountHolder: "ILHAM HIDAYAT",
      status: "verified",
      isDefault: true,
    },
  ];
  private readonly payouts: PayoutRequest[] = [];
  private readonly bankByIdempotencyKey = new Map<string, BankAccount>();
  private readonly payoutByIdempotencyKey = new Map<string, PayoutRequest>();

  private lastMode = "consumer";

  async currentProfile(): Promise<Profile | null> {
    return { ...this.profile, lastMode: this.lastMode };
  }

  async updateProfile(fields: { name?: string; email?: string; phone?: string; avatarUrl?: string }): Promise<void> {
    const filled = (value: string | undefined) => (value !== undefined && value.trim() ? value.trim() : null);
    this.profile = {
      id: this.profile.id,
      name: filled(fields.name) ?? this.profile.name,
      email: filled(fields.email) ?? this.profile.email,
      phone: filled(fields.phone) ?? this.profile.phone,
      avatarUrl: fields.avatarUrl ?? this.profile.avatarUrl,
      lastMode: this.profile.lastMode,
    };
  }

  async setLastMode(mode: string): Promise<void> {
    this.lastMode = mode;
  }

  async nearbyBags({ latitude = null, longitude = null, filter = EMPTY_FILTER }: LocationOptions = {}): Promise<Bag[]> {
    const bags = [...SampleData.nearbyBags, ...this.locallyPublishedBags()]
      .map((bag) => {
        const remaining = this.remainingStock.get(bag.id) ?? bag.quantityLeft;
        let updated: Bag = { ...bag, quantityLeft: remaining, soldOut: remaining <= 0 };
        const merchantLat = bag.merchant.latitude;
        const merchantLng = bag.merchant.longitude;
        if (latitude !== null && longitude !== null && merchantLat !== null && merchantLng !== null) {
          const distance = distanceKm(latitude, longitude, merchantLat, merchantLng);
          updated = { ...updated, merchant: { ...updated.merchant, distance: `${distance.toFixed(1)} km` } };
        }
        return updated;
      })
      .filter((bag) => {
        const now = new Date();
        if (bag.availableOn !== null && dateOnly(bag.availableOn) > dateOnly(now)) return false;
        if (bag.pickupEndsAt !== null && !(bag.pickupEndsAt.getTime() > now.getTime())) return false;
        return bagMatchesFilter(bag, filter);
      });
    if (latitude !== null && longitude !== null) {
      const km = (bag: Bag) => tryParseDouble(bag.merchant.distance.split(" ")[0]) ?? Number.POSITIVE_INFINITY;
      bags.sort((a, b) => {
        const left = km(a);
        const right = km(b);
        return left === right ? 0 : left < right ? -1 : 1;
      });
    }
    return bags;
  }

  private locallyPublishedBags(): Bag[] {
    const merchant = this.localMerchant();
    if (merchant === null || this.locallyPublishedBagIds.size === 0) return [];
    return this.bags
      .filter((bag) => this.locallyPublishedBagIds.has(bag.id) && bag.active && bag.quantityLeft > 0)
      .map((bag) => ({
        id: bag.id,
        merchant,
        title: bag.title,
        description: bag.description,
        originalPrice: Math.max(bag.originalPrice, bag.salePrice),
        salePrice: bag.salePrice,
        quantityLeft: bag.quantityLeft,
        quantityTotal: bag.total,
        pickupWindow: bag.pickupWindow,
        image: bag.image,
        contents: bag.contents,
        soldOut: false,
        availableOn: bag.availableOn,
        pickupStartsAt: bag.pickupStartsAt,
        pickupEndsAt: bag.pickupEndsAt,
      }));
  }

  private localMerchant(): Merchant | null {
    const store = this.store;
    if (store === null) return null;
    const storeName = store.name.trim();
    return {
      id: store.id,
      name: storeName,
      initial: storeName ? storeName.slice(0, 1).toUpperCase() : "T",
      avatarColor: SampleData.rotiNyaman.avatarColor,
      category: store.category,
      rating: 0,
      reviewCount: 0,
      distance: "Lokasi toko",
      address: store.address,
      hours: `${store.openTime}–${store.closeTime}`,
      coverImage: store.logoUrl ?? SampleData.img1,
      bagsSaved: 0,
      latitude: store.latitude,
      longitude: store.longitude,
    };
  }

  async searchBags(query: string, options: LocationOptions = {}): Promise<Bag[]> {
    const q = query.toLowerCase();
    const available = await this.nearbyBags(options);
    return available.filter(
      (bag) =>
        bag.title.toLowerCase().includes(q) ||
        bag.merchant.name.toLowerCase().includes(q) ||
        bag.merchant.category.toLowerCase().includes(q),
    );
  }

  async bagsByMerchant(merchantId: string): Promise<Bag[]> {
    const available = await this.nearbyBags();
    return available.filter((bag) => bag.merchant.id === merchantId);
  }

  /** Web deep links: the bag only while it is still available, like `available_bags`. */
  async bagById(bagId: string): Promise<Bag | null> {
    const available = await this.nearbyBags();
    return available.find((bag) => bag.id === bagId) ?? null;
  }

  /** Web deep links: a sample store, or the demo merchant's own store. */
  async merchantById(merchantId: string): Promise<Merchant | null> {
    const local = this.localMerchant();
    if (local !== null && local.id === merchantId) return local;
    return SampleData.merchants.find((merchant) => merchant.id === merchantId) ?? null;
  }

  async favoriteMerchantIds(): Promise<Set<string>> {
    return new Set(this.favorites);
  }

  async toggleFavorite(merchantId: string): Promise<boolean> {
    if (this.favorites.delete(merchantId)) return false;
    const merchantExists = SampleData.merchants.some((merchant) => merchant.id === merchantId);
    if (!merchantExists && this.store?.id !== merchantId) {
      throw new BackendException("merchant_not_found", "Toko tidak ditemukan atau sudah tidak aktif.");
    }
    this.favorites.add(merchantId);
    return true;
  }

  async favoriteStores(): Promise<FavoriteStore[]> {
    const availableBags = await this.nearbyBags();
    const merchants = new Map<string, Merchant>();
    for (const merchant of SampleData.merchants) merchants.set(merchant.id, merchant);
    for (const bag of availableBags) merchants.set(bag.merchant.id, bag.merchant);
    const localMerchant = this.localMerchant();
    if (localMerchant !== null) merchants.set(localMerchant.id, localMerchant);
    const quantities = new Map<string, number>();
    for (const bag of availableBags) {
      quantities.set(bag.merchant.id, (quantities.get(bag.merchant.id) ?? 0) + bag.quantityLeft);
    }
    const stores: FavoriteStore[] = [];
    for (const merchantId of this.favorites) {
      const merchant = merchants.get(merchantId);
      if (!merchant) continue;
      const quantity = quantities.get(merchantId) ?? 0;
      stores.push({
        merchant,
        availability: quantity > 0 ? `${quantity} bag tersedia` : "Habis hari ini",
        soldOut: quantity === 0,
      });
    }
    return stores;
  }

  async placeOrder(bag: Bag, qty: number, method: string, idempotencyKey: string): Promise<OrderRecord> {
    const normalizedMethod = method.trim();
    if (qty < 1 || qty > 100) {
      throw new BackendException("invalid_quantity", "Jumlah bag harus antara 1 dan 100.");
    }
    if (!normalizedMethod || normalizedMethod.length > 64) {
      throw new BackendException("invalid_payment_method", "Metode pembayaran tidak valid.");
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new BackendException("invalid_idempotency_key", "Identitas permintaan checkout tidak valid.");
    }

    const signature = `${bag.id}|${qty}|${normalizedMethod}`;
    const existing = this.ordersByIdempotencyKey.get(idempotencyKey);
    if (existing) {
      if (this.orderSignaturesByIdempotencyKey.get(idempotencyKey) !== signature) {
        throw new BackendException("idempotency_conflict", "Permintaan yang sama sudah diproses dengan data berbeda.");
      }
      return existing;
    }
    if (this.store?.id === bag.merchant.id) {
      throw new BackendException("self_purchase_forbidden", "Merchant tidak dapat membeli bag dari tokonya sendiri.");
    }
    const remaining = this.remainingStock.get(bag.id) ?? bag.quantityLeft;
    if (remaining < qty || bag.soldOut) {
      throw new BackendException("insufficient_stock", "Stok bag sudah berubah. Silakan pilih jumlah yang tersedia.");
    }
    const subtotal = bag.salePrice * qty;
    const serviceFee = 1000;
    const now = new Date();
    const code = this.nextCode();
    const order = orderRecord({
      id: this.nextId("order-"),
      bag,
      code,
      dateLabel: "Hari ini",
      amount: subtotal + serviceFee,
      status: "pending",
      quantity: qty,
      paymentMethod: normalizedMethod,
      createdAt: now,
      expiresAt: bag.pickupEndsAt ?? new Date(now.getTime() + 4 * HOUR_MS),
      subtotalAmount: subtotal,
      serviceFee,
      merchantNetAmount: Math.round(subtotal * 0.9),
    });
    this.remainingStock.set(bag.id, remaining - qty);
    this.active.unshift(order);
    this.ordersByIdempotencyKey.set(idempotencyKey, order);
    this.orderSignaturesByIdempotencyKey.set(idempotencyKey, signature);
    this.incoming.unshift(
      incomingOrder({
        id: order.id,
        customer: this.profile.name,
        initial: this.profile.name.slice(0, 1).toUpperCase(),
        time: "Baru saja",
        bags: qty,
        code,
        status: "paid",
        bagTitle: bag.title,
        bagImage: bag.image,
        pickupWindow: bag.pickupWindow,
        unitPrice: bag.salePrice,
        subtotalAmount: subtotal,
        serviceFee,
        merchantNetAmount: Math.round(subtotal * 0.9),
        createdAt: now,
        pickupStartsAt: bag.pickupStartsAt,
        expiresAt: order.expiresAt,
      }),
    );
    this.changed("incoming");
    return order;
  }

  async refreshPayment(order: OrderRecord): Promise<OrderRecord> {
    for (const candidate of [...this.active, ...this.history]) {
      if (candidate.id === order.id) return candidate;
    }
    throw new BackendException("order_not_found", "Pesanan tidak ditemukan.");
  }

  async activeOrders(): Promise<OrderRecord[]> {
    return [...this.active];
  }

  async orderHistory(): Promise<OrderRecord[]> {
    return [...this.history];
  }

  async issuePickupToken(order: OrderRecord): Promise<OrderRecord> {
    const index = this.active.findIndex((item) => item.id === order.id);
    if (index < 0) throw new BackendException("order_not_found", "Pesanan tidak ditemukan.");
    const current = this.active[index];
    if (current.status !== "ready") {
      throw new BackendException("order_not_redeemable", "QR baru tersedia setelah merchant menandai pesanan siap.");
    }
    const now = new Date();
    if (current.expiresAt !== null && !(current.expiresAt.getTime() > now.getTime())) {
      throw new BackendException("order_expired", "Masa pickup pesanan sudah berakhir.");
    }
    const token = this.nextToken();
    const refreshed: OrderRecord = { ...current, pickupToken: token };
    this.active[index] = refreshed;
    this.removePickupTokensForOrder(order.id);
    this.pickupTokens.set(token, order.id);
    const tokenDeadline = new Date(now.getTime() + 90_000);
    this.pickupTokenExpiries.set(
      token,
      current.expiresAt !== null && current.expiresAt.getTime() < tokenDeadline.getTime() ? current.expiresAt : tokenDeadline,
    );
    this.cacheOrderRecord(refreshed);
    return refreshed;
  }

  /** Idempotent replays return the latest state, never a pickup token. */
  private cacheOrderRecord(record: OrderRecord) {
    const safeRecord: OrderRecord = { ...record, pickupToken: null };
    for (const [key, value] of [...this.ordersByIdempotencyKey]) {
      if (value.id === record.id) this.ordersByIdempotencyKey.set(key, safeRecord);
    }
  }

  private removePickupTokensForOrder(orderId: string) {
    const tokens = [...this.pickupTokens].filter(([, value]) => value === orderId).map(([token]) => token);
    for (const token of tokens) {
      this.pickupTokens.delete(token);
      this.pickupTokenExpiries.delete(token);
    }
  }

  async submitReview(order: OrderRecord, rating: number, tags: string[], comment: string): Promise<void> {
    if (rating < 1 || rating > 5) {
      throw new BackendException("invalid_rating", "Pilih rating 1 sampai 5.");
    }
    const index = this.history.findIndex((item) => (order.id !== "" && item.id === order.id) || item.code === order.code);
    if (index < 0 || this.history[index].status !== "done") {
      throw new BackendException("order_not_redeemed", "Ulasan hanya dapat dikirim setelah pesanan diambil.");
    }
    if (this.history[index].reviewed) {
      throw new BackendException("already_reviewed", "Pesanan sudah diulas.");
    }
    this.history[index] = { ...this.history[index], reviewed: true, canRate: false };
    this.reviews.unshift({
      id: this.nextId("review-"),
      orderId: order.id,
      orderReference: order.code,
      customerName: this.profile.name,
      rating,
      tags: Object.freeze([...tags]),
      comment: comment.trim(),
      createdAt: new Date(),
    });
    this.notifs.unshift({
      id: this.nextId("notification-"),
      title: "Ulasan baru",
      body: `${rating} bintang untuk ${order.code}.`,
      time: "Baru saja",
      type: "rating",
      group: "Hari ini",
      unread: true,
      route: "merchant_reviews",
      createdAt: new Date(),
    });
    this.changed("notifications");
  }

  async notifications(): Promise<AppNotification[]> {
    return [...this.notifs];
  }

  async markAllNotificationsRead(): Promise<void> {
    for (let i = 0; i < this.notifs.length; i++) {
      if (this.notifs[i].unread) this.notifs[i] = { ...this.notifs[i], unread: false };
    }
    this.changed("notifications");
  }

  watchNotifications(onData: (values: AppNotification[]) => void, _onError: (error: unknown) => void): Unsubscribe {
    return this.watchSnapshots("notifications", () => [...this.notifs], onData);
  }

  async myStore(): Promise<StoreProfile | null> {
    return this.store;
  }

  async upsertStore(input: StoreInput): Promise<void> {
    this.store = {
      id: this.store?.id ?? "store-me",
      name: input.name,
      category: input.category,
      address: input.address,
      openTime: input.open,
      closeTime: input.close,
      description: input.description ?? "",
      logoUrl: input.logoUrl ?? this.store?.logoUrl ?? null,
      latitude: input.latitude ?? this.store?.latitude ?? null,
      longitude: input.longitude ?? this.store?.longitude ?? null,
    };
  }

  async myBags(): Promise<MerchantBag[]> {
    return [...this.bags];
  }

  async addBag(input: BagInput): Promise<void> {
    const contentsError = bagContentsValidationError(input.contents);
    if (contentsError) throw new BackendException("invalid_bag_contents", contentsError);
    if (!input.title.trim() || input.salePrice <= 0 || input.originalPrice < input.salePrice || input.total <= 0) {
      throw new BackendException("invalid_bag", "Periksa nama, harga, dan jumlah bag.");
    }
    const id = this.nextId("mb");
    this.bags.unshift({
      id,
      title: input.title,
      salePrice: input.salePrice,
      pickupWindow: input.pickupWindow,
      sold: 0,
      total: input.total,
      image: input.imageUrl ?? SampleData.img1,
      active: true,
      statusNote: null,
      description: input.description.trim(),
      contents: normalizeBagContents(input.contents),
      originalPrice: input.originalPrice,
      quantityLeft: input.total,
      availableOn: input.availableOn ?? null,
      pickupStartsAt: input.pickupStartsAt ?? null,
      pickupEndsAt: input.pickupEndsAt ?? null,
    });
    this.locallyPublishedBagIds.add(id);
  }

  async updateBag(bag: MerchantBag, input: BagInput): Promise<void> {
    const contentsError = bagContentsValidationError(input.contents);
    if (contentsError) throw new BackendException("invalid_bag_contents", contentsError);
    if (!input.title.trim() || input.salePrice <= 0 || input.originalPrice < input.salePrice || input.total < bag.sold) {
      throw new BackendException(
        "invalid_bag",
        "Jumlah total tidak boleh di bawah jumlah terjual dan harga asli harus valid.",
      );
    }
    const i = this.bags.findIndex((item) => item.id === bag.id);
    if (i !== -1) {
      this.bags[i] = {
        ...bag,
        title: input.title,
        salePrice: input.salePrice,
        pickupWindow: input.pickupWindow,
        total: input.total,
        image: input.imageUrl ?? bag.image,
        description: input.description.trim(),
        contents: normalizeBagContents(input.contents),
        originalPrice: input.originalPrice,
        quantityLeft: input.total - bag.sold,
        availableOn: input.availableOn ?? bag.availableOn,
        pickupStartsAt: input.pickupStartsAt ?? bag.pickupStartsAt,
        pickupEndsAt: input.pickupEndsAt ?? bag.pickupEndsAt,
      };
    }
  }

  async setBagActive(bag: MerchantBag, active: boolean): Promise<void> {
    const i = this.bags.findIndex((item) => item.id === bag.id);
    if (i !== -1) this.bags[i] = { ...bag, active, statusNote: active ? null : bag.statusNote };
  }

  async duplicateBag(bag: MerchantBag): Promise<void> {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const moveToTomorrow = (value: Date | null) =>
      value === null
        ? null
        : new Date(
            tomorrow.getFullYear(),
            tomorrow.getMonth(),
            tomorrow.getDate(),
            value.getHours(),
            value.getMinutes(),
            value.getSeconds(),
          );
    const id = this.nextId("mb");
    this.bags.unshift({
      ...bag,
      id,
      sold: 0,
      quantityLeft: bag.total,
      active: true,
      statusNote: null,
      availableOn: tomorrow,
      pickupStartsAt: moveToTomorrow(bag.pickupStartsAt),
      pickupEndsAt: moveToTomorrow(bag.pickupEndsAt),
    });
    this.locallyPublishedBagIds.add(id);
  }

  async incomingOrders(): Promise<IncomingOrder[]> {
    return [...this.incoming];
  }

  watchIncomingOrders(onData: (values: IncomingOrder[]) => void, _onError: (error: unknown) => void): Unsubscribe {
    return this.watchSnapshots("incoming", () => [...this.incoming], onData);
  }

  async markOrderReady(orderId: string): Promise<void> {
    const index = this.incoming.findIndex((order) => order.id === orderId);
    if (index < 0) throw new BackendException("order_not_found", "Pesanan tidak ditemukan.");
    const order = this.incoming[index];
    if (order.status !== "paid" && order.status !== "preparing") {
      throw new BackendException("invalid_order_status", "Pesanan ini tidak dapat ditandai siap.");
    }
    this.incoming[index] = copyIncomingOrder(order, { status: "ready", needsAction: false });
    const consumerIndex = this.active.findIndex((item) => item.id === orderId);
    if (consumerIndex >= 0) {
      const readyOrder: OrderRecord = { ...this.active[consumerIndex], status: "ready" };
      this.active[consumerIndex] = readyOrder;
      this.cacheOrderRecord(readyOrder);
    }
    this.notifs.unshift({
      id: this.nextId("notification-"),
      title: "Pesanan siap diambil",
      body: `${order.bagTitle} sudah siap.`,
      time: "Baru saja",
      type: "ready",
      group: "Hari ini",
      unread: true,
      route: "orders",
      createdAt: new Date(),
    });
    this.changed("incoming");
    this.changed("notifications");
  }

  async cancelMerchantOrder(orderId: string): Promise<IncomingOrder> {
    const index = this.incoming.findIndex((order) => order.id === orderId);
    if (index < 0) throw new BackendException("order_not_found", "Pesanan tidak ditemukan.");
    const source = this.incoming[index];
    if (source.status === "cancelled") return source;
    if (source.status !== "paid" && source.status !== "preparing" && source.status !== "ready") {
      throw new BackendException("invalid_order_status", "Pesanan ini tidak dapat dibatalkan.");
    }

    const cancelled = copyIncomingOrder(source, { status: "cancelled", needsAction: false });
    this.incoming[index] = cancelled;

    const consumerIndex = this.active.findIndex((order) => order.id === orderId);
    if (consumerIndex >= 0) {
      const [consumerOrder] = this.active.splice(consumerIndex, 1);
      const bag = consumerOrder.bag;
      const current = this.remainingStock.get(bag.id) ?? bag.quantityLeft;
      this.remainingStock.set(bag.id, Math.min(bag.quantityTotal, current + consumerOrder.quantity));
      const historyOrder: OrderRecord = { ...consumerOrder, status: "cancelled", canRate: false, pickupToken: null };
      this.history.unshift(historyOrder);
      this.cacheOrderRecord(historyOrder);
    }

    const bagIndex = this.bags.findIndex((bag) => bag.title === source.bagTitle);
    if (bagIndex >= 0) {
      const bag = this.bags[bagIndex];
      const restored = Math.min(bag.total, bag.quantityLeft + source.bags);
      this.bags[bagIndex] = {
        ...bag,
        sold: bag.total - restored,
        quantityLeft: restored,
        active: bag.active || bag.quantityLeft === 0,
        statusNote: null,
      };
    }

    this.removePickupTokensForOrder(orderId);
    this.notifs.unshift({
      id: this.nextId("notification-"),
      title: "Pesanan dibatalkan",
      body: `${source.bagTitle} telah dibatalkan oleh merchant.`,
      time: "Baru saja",
      type: "payment",
      group: "Hari ini",
      unread: true,
      route: "orders",
      createdAt: new Date(),
    });
    this.changed("incoming");
    this.changed("notifications");
    return cancelled;
  }

  async redeemOrder(pickupToken: string): Promise<IncomingOrder | null> {
    if (!pickupToken.trim()) throw new BackendException("invalid_pickup_code", "QR pickup tidak valid.");
    const token = pickupToken.trim();
    const orderId = this.pickupTokens.get(token);
    if (orderId === undefined) return null;
    const tokenExpiry = this.pickupTokenExpiries.get(token);
    if (tokenExpiry === undefined || !(tokenExpiry.getTime() > Date.now())) {
      this.pickupTokens.delete(token);
      this.pickupTokenExpiries.delete(token);
      throw new BackendException("pickup_token_expired", "QR sudah diperbarui. Minta pembeli menampilkan QR terbaru.");
    }
    const idx = this.incoming.findIndex((order) => order.id === orderId && !order.redeemed);
    if (idx === -1) return null;
    const source = this.incoming[idx];
    if (source.expiresAt !== null && source.expiresAt.getTime() < Date.now()) {
      throw new BackendException("order_expired", "Masa pickup pesanan sudah berakhir.");
    }
    if (source.pickupStartsAt !== null && source.pickupStartsAt.getTime() > Date.now()) {
      throw new BackendException("pickup_not_started", "Waktu pickup pesanan belum dimulai.");
    }
    if (source.status !== "ready") {
      throw new BackendException("invalid_order_status", "Pesanan belum siap atau sudah tidak dapat diambil.");
    }
    const redeemed = copyIncomingOrder(source, {
      redeemed: true,
      status: "redeemed",
      needsAction: false,
      redeemedAt: new Date(),
    });
    this.incoming[idx] = redeemed;
    this.removePickupTokensForOrder(orderId);
    const consumerIndex = this.active.findIndex((order) => order.id === orderId);
    if (consumerIndex >= 0) {
      const [removed] = this.active.splice(consumerIndex, 1);
      const consumerOrder: OrderRecord = { ...removed, status: "done", canRate: true, pickupToken: null };
      this.history.unshift(consumerOrder);
      this.cacheOrderRecord(consumerOrder);
    }
    this.soldToday += redeemed.bags;
    this.incomeToday += redeemed.merchantNetAmount;
    this.balanceValue += redeemed.merchantNetAmount;
    this.tx.unshift({
      id: this.nextId("tx-"),
      title: `Order ${redeemed.code}`,
      subtitle: "Hari ini · selesai",
      amount: redeemed.merchantNetAmount,
      kind: "income",
      createdAt: new Date(),
      status: "completed",
    });
    this.changed("incoming");
    this.changed("transactions");
    return redeemed;
  }

  async merchantReviews(): Promise<MerchantReview[]> {
    return [...this.reviews];
  }

  async merchantStats(): Promise<MerchantStats> {
    return {
      bagsSoldToday: this.soldToday,
      incomeToday: this.incomeToday,
      activeBagCount: this.bags.filter((bag) => bag.active).length,
      pendingOrderCount: this.incoming.filter((order) => !order.redeemed).length,
      incomeThisMonth: this.incomeToday,
      foodSavedKg: this.soldToday * 0.5,
    };
  }

  async balance(): Promise<number> {
    return this.balanceValue;
  }

  async transactions(): Promise<TxRecord[]> {
    return [...this.tx];
  }

  watchTransactions(onData: (values: TxRecord[]) => void, _onError: (error: unknown) => void): Unsubscribe {
    return this.watchSnapshots("transactions", () => [...this.tx], onData);
  }

  async bankAccounts(): Promise<BankAccount[]> {
    return [...this.bankAccountList];
  }

  async setDefaultBankAccount(bankAccountId: string): Promise<void> {
    const index = this.bankAccountList.findIndex((account) => account.id === bankAccountId);
    if (index < 0) throw new BackendException("bank_account_not_found", "Rekening tidak ditemukan.");
    for (let i = 0; i < this.bankAccountList.length; i++) {
      this.bankAccountList[i] = { ...this.bankAccountList[i], isDefault: i === index };
    }
  }

  async saveBankAccount(input: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountHolder: string;
    idempotencyKey: string;
  }): Promise<BankAccount> {
    const existing = this.bankByIdempotencyKey.get(input.idempotencyKey);
    if (existing) return existing;
    const digits = input.accountNumber.replace(/\D/g, "");
    if (digits.length < 8 || input.accountHolder.trim().length < 3) {
      throw new BackendException("invalid_bank_account", "Nomor rekening atau nama pemilik belum valid.");
    }
    const account: BankAccount = {
      id: this.nextId("bank-"),
      bankCode: input.bankCode,
      bankName: input.bankName,
      accountNumberMasked: `•••• ${digits.slice(digits.length - 4)}`,
      accountHolder: input.accountHolder.trim().toUpperCase(),
      status: "pending",
      isDefault: this.bankAccountList.length === 0,
    };
    this.bankAccountList.push(account);
    this.bankByIdempotencyKey.set(input.idempotencyKey, account);
    return account;
  }

  async payoutRequests(): Promise<PayoutRequest[]> {
    return [...this.payouts];
  }

  async requestPayout(input: { amount: number; bankAccountId: string; idempotencyKey: string }): Promise<PayoutRequest> {
    const existing = this.payoutByIdempotencyKey.get(input.idempotencyKey);
    if (existing) return existing;
    if (input.amount < 50000) {
      throw new BackendException("minimum_payout", "Minimum penarikan adalah Rp50.000.");
    }
    if (input.amount > this.balanceValue) {
      throw new BackendException("insufficient_balance", "Saldo tidak mencukupi.");
    }
    const bank = this.bankAccountList.find((item) => item.id === input.bankAccountId);
    if (!bank) throw new BackendException("bank_not_found", "Rekening tidak ditemukan.");
    if (bank.status !== "verified") {
      throw new BackendException("bank_not_verified", "Rekening masih dalam verifikasi.");
    }
    const fee = 2500;
    const request: PayoutRequest = {
      id: this.nextId("payout-"),
      grossAmount: input.amount,
      feeAmount: fee,
      netAmount: input.amount - fee,
      status: "pending",
      bankAccount: bank,
      createdAt: new Date(),
    };
    this.balanceValue -= input.amount;
    this.payouts.unshift(request);
    this.payoutByIdempotencyKey.set(input.idempotencyKey, request);
    this.tx.unshift({
      id: this.nextId("tx-"),
      title: `Penarikan ke ${bank.bankName}`,
      subtitle: "Hari ini · menunggu diproses",
      amount: input.amount,
      kind: "withdrawal",
      createdAt: new Date(),
      status: "pending",
    });
    this.changed("transactions");
    return request;
  }

  async deleteAccount(): Promise<void> {
    this.clearSessionCache();
    this.profile = { id: "me", name: "Pengguna", email: "", phone: "", avatarUrl: null, lastMode: "consumer" };
    this.store = null;
    this.lastMode = "consumer";
    this.favorites.clear();
    this.bags.length = 0;
    this.active.length = 0;
    this.history.length = 0;
    this.incoming.length = 0;
    this.reviews.length = 0;
    this.notifs.length = 0;
    this.tx.length = 0;
    this.bankAccountList.length = 0;
    this.payouts.length = 0;
    this.remainingStock.clear();
    this.locallyPublishedBagIds.clear();
    this.balanceValue = 0;
    this.soldToday = 0;
    this.incomeToday = 0;
    this.changed("notifications");
    this.changed("incoming");
    this.changed("transactions");
  }

  /**
   * Offline: nothing is uploaded. The chosen photo is shown from a local
   * object URL for the rest of the session. The picker opens synchronously
   * so the browser still sees the user's tap.
   */
  uploadImage(_bucket: BackendBucket): Promise<string | null> {
    return pickImageFile().then((file) => (file ? URL.createObjectURL(file) : null));
  }

  async uploadImageBytes(_bucket: BackendBucket, bytes: Uint8Array, filename: string): Promise<string | null> {
    const ext = filename.includes(".") ? (filename.split(".").pop() ?? "").toLowerCase() : "";
    const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  }
}
