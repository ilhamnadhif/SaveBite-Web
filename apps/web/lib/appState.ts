"use client";

/**
 * Reactive cache over the active backend — a port of `lib/app_state.dart`.
 *
 * One mutable singleton, like Flutter's `ChangeNotifier`. Screens read fields
 * directly and re-render through `useAppState()` whenever `notifyListeners()`
 * runs (the `ListenableBuilder` pattern). Every user cache is dropped when
 * the session changes, and results of older requests are ignored through
 * the session epoch and per-scope request generations.
 */
import { backend } from "./backend";
import {
  BackendException,
  DEFAULT_BUSINESS_CONFIG,
  type BackendBucket,
  type BagInput,
  type BusinessConfig,
  type Unsubscribe,
} from "./backend/types";
import {
  LocationError,
  LocationPermissionSupport,
  checkPermission,
  getCurrentPosition,
  isLocationServiceEnabled,
  requestPermission,
  validCoordinates,
} from "./location";
import {
  EMPTY_ADMIN_STATS,
  EMPTY_FILTER,
  bagMatchesFilter,
  bankLabel,
  copyIncomingOrder,
  isAwaitingCustomer,
  isPaid,
  isTerminalFailure,
  type AdminComplaint,
  type AdminMerchant,
  type AdminStats,
  type AdminUser,
  type AppNotification,
  type Bag,
  type BagFilter,
  type BankAccount,
  type Complaint,
  type ComplaintCategory,
  type ComplaintStatus,
  type FavoriteStore,
  type IncomingOrder,
  type MerchantBag,
  type MerchantReview,
  type MerchantStats,
  type OrderRecord,
  type PayoutRequest,
  type Profile,
  type StoreProfile,
  type TransactionReport,
  type TxRecord,
  type VerificationStatus,
} from "./models";
import { isMerchantOrdersNotificationRoute } from "./notificationRoute";

export type AppMode = "consumer" | "merchant";

type LoadScope =
  | "profile"
  | "consumer"
  | "orders"
  | "favorites"
  | "notifications"
  | "store"
  | "merchant"
  | "merchantReviews"
  | "balance"
  | "admin"
  | "adminUsers"
  | "report";

const KEYS = {
  onboarding: "onboarding_seen",
  locationPrimed: "location_primed",
  locationLabel: "location_label",
  latitude: "location_latitude",
  longitude: "location_longitude",
  locationFromDevice: "location_from_device",
  deviceLatitude: "device_location_latitude",
  deviceLongitude: "device_location_longitude",
  locationAccuracy: "location_accuracy_meters",
  locationReducedAccuracy: "location_reduced_accuracy",
  paymentMethod: "default_payment_method",
  merchantIntent: "pending_merchant_intent",
  checkoutIdempotency: "pending_checkout_idempotency_v1",
  checkoutOrderIds: "pending_checkout_order_ids_v1",
  payoutIdempotency: "pending_payout_idempotency_v1",
} as const;

/** SharedPreferences equivalent: best-effort localStorage. */
const prefs = {
  key: (name: string) => `savebite.${name}`,
  get(name: string): string | null {
    try {
      return window.localStorage.getItem(prefs.key(name));
    } catch {
      return null;
    }
  },
  set(name: string, value: string) {
    try {
      window.localStorage.setItem(prefs.key(name), value);
    } catch {
      // Private mode or a full quota: local preferences are best effort.
    }
  },
  remove(name: string) {
    try {
      window.localStorage.removeItem(prefs.key(name));
    } catch {
      // Best effort.
    }
  },
  bool(name: string): boolean | null {
    const value = prefs.get(name);
    return value === "true" ? true : value === "false" ? false : null;
  },
  num(name: string): number | null {
    const value = prefs.get(name);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  },
};

export const CITIES = ["Margonda, Depok", "Cibinong, Bogor", "Kemang, Jakarta"] as const;
export const PAYMENT_METHODS = ["QRIS"] as const;

const CITY_COORDINATES: Record<string, [number, number]> = {
  "Margonda, Depok": [-6.3725, 106.8323],
  "Cibinong, Bogor": [-6.4853, 106.8422],
  "Kemang, Jakarta": [-6.2607, 106.8134],
};

export const newUuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
      );

function decodeStringMap(value: string | null): Map<string, string> {
  if (!value) return new Map();
  try {
    const decoded: unknown = JSON.parse(value);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return new Map();
    return new Map(Object.entries(decoded as Record<string, unknown>).map(([key, item]) => [key, String(item)]));
  } catch {
    return new Map();
  }
}

const encodeStringMap = (map: Map<string, string>) => JSON.stringify(Object.fromEntries(map));

export class AppState {
  private listeners = new Set<() => void>();
  private versionValue = 0;

  private sessionEpoch = 0;
  private generations: Record<LoadScope, number> = {
    profile: 0,
    consumer: 0,
    orders: 0,
    favorites: 0,
    notifications: 0,
    store: 0,
    merchant: 0,
    merchantReviews: 0,
    balance: 0,
    admin: 0,
    adminUsers: 0,
    report: 0,
  };
  private notificationSubscription: Unsubscribe | null = null;
  private incomingSubscription: Unsubscribe | null = null;
  private transactionSubscription: Unsubscribe | null = null;
  private isSyncingPendingPayments = false;
  private checkoutKeys = new Map<string, string>();
  private checkoutOrderIds = new Map<string, string>();
  private checkoutRequestsInFlight = new Map<string, number>();
  private payoutKeys = new Map<string, string>();

  mode: AppMode = "consumer";
  onboardingSeen = false;
  merchantSetupDone = false;
  locationPrimed = false;
  pendingMerchantIntent: boolean | null = null;
  lastMode = "consumer";

  location = "Lokasi belum dipilih";
  userLatitude: number | null = null;
  userLongitude: number | null = null;
  userLocationIsFromDevice = false;
  deviceLatitude: number | null = null;
  deviceLongitude: number | null = null;
  userLocationAccuracyMeters: number | null = null;
  userLocationAccuracyReduced = false;
  hasLocationPermission = false;
  locationPermissionDeniedForever = false;
  locationServicesEnabled = true;
  isDeterminingLocation = false;
  currentFilter: BagFilter = EMPTY_FILTER;

  readonly usesBrowserPermissionSettings = LocationPermissionSupport.usesBrowserSettings;
  readonly browserLocationPermissionGuidance = LocationPermissionSupport.browserGuidance;
  get locationSettingsActionLabel(): string {
    return LocationPermissionSupport.settingsActionLabel({ locationServicesEnabled: this.locationServicesEnabled });
  }

  isBootstrapping = false;
  isLoadingConsumer = false;
  isLoadingOrders = false;
  isLoadingMerchant = false;
  isLoadingMerchantReviews = false;
  isLoadingBalance = false;
  isLoadingNotifications = false;
  isLoadingAdmin = false;
  isLoadingAdminUsers = false;
  isLoadingReport = false;

  /** From `current_user_is_admin()`. Every admin RPC still checks the role. */
  isAdmin = false;
  accountSuspended = false;
  suspendedReason: string | null = null;
  storeVerification: VerificationStatus = "verified";
  storeVerificationNote: string | null = null;

  complaints: Complaint[] = [];
  adminStats: AdminStats = EMPTY_ADMIN_STATS;
  adminMerchants: AdminMerchant[] = [];
  adminUsers: AdminUser[] = [];
  adminComplaints: AdminComplaint[] = [];
  report: TransactionReport | null = null;

  /**
   * Global error only for bootstrap, location, and cross-domain operations.
   * Tab loaders use per-scope errors so parallel requests do not clear each
   * other's messages or show them on the wrong screen.
   */
  errorMessage: string | null = null;
  private loadErrors = new Map<LoadScope, string>();

  get profileError() {
    return this.loadErrors.get("profile") ?? null;
  }
  get consumerError() {
    return this.loadErrors.get("consumer") ?? null;
  }
  get ordersError() {
    return this.loadErrors.get("orders") ?? null;
  }
  get favoritesError() {
    return this.loadErrors.get("favorites") ?? null;
  }
  get notificationsError() {
    return this.loadErrors.get("notifications") ?? null;
  }
  get storeError() {
    return this.loadErrors.get("store") ?? null;
  }
  get merchantError() {
    return this.loadErrors.get("merchant") ?? null;
  }
  get merchantReviewsError() {
    return this.loadErrors.get("merchantReviews") ?? null;
  }
  get balanceError() {
    return this.loadErrors.get("balance") ?? null;
  }
  get adminError() {
    return this.loadErrors.get("admin") ?? null;
  }
  get adminUsersError() {
    return this.loadErrors.get("adminUsers") ?? null;
  }
  get transactionReportError() {
    return this.loadErrors.get("report") ?? null;
  }

  defaultPaymentMethod = "QRIS";
  selectedBank = "";
  businessConfig: BusinessConfig = DEFAULT_BUSINESS_CONFIG;

  userName = "Pengguna";
  userEmail = "";
  userPhone = "";
  userAvatarUrl: string | null = null;
  get userInitials(): string {
    const parts = this.userName.trim().split(/\s+/);
    if (!parts.length || !parts[0]) return "?";
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  storeName = "";
  storeCategory = "Bakery";
  storeAddress = "";
  openTime = "08.00";
  closeTime = "21.00";
  storeDescription = "";
  storeLogoUrl: string | null = null;
  storeLatitude: number | null = null;
  storeLongitude: number | null = null;

  private allNearby: Bag[] = [];
  private nearby: Bag[] = [];
  private favIds = new Set<string>();
  private favStores: FavoriteStore[] = [];
  private active: OrderRecord[] = [];
  private history: OrderRecord[] = [];
  private notifs: AppNotification[] = [];
  private bags: MerchantBag[] = [];
  private incoming: IncomingOrder[] = [];
  private reviews: MerchantReview[] = [];
  private tx: TxRecord[] = [];
  private bankAccountList: BankAccount[] = [];
  private payouts: PayoutRequest[] = [];
  balance = 0;
  bagsSoldToday = 0;
  incomeToday = 0;
  incomeThisMonth = 0;
  foodSavedKg = 0;

  // ── ChangeNotifier ──────────────────────────────────────────────────────

  addListener(listener: () => void) {
    this.listeners.add(listener);
  }

  removeListener(listener: () => void) {
    this.listeners.delete(listener);
  }

  /** For `useSyncExternalStore`. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.versionValue;

  notifyListeners() {
    this.versionValue++;
    for (const listener of [...this.listeners]) listener();
  }

  // ── Read-only views ─────────────────────────────────────────────────────

  get nearbyBags(): readonly Bag[] {
    return this.nearby;
  }
  get allNearbyBags(): readonly Bag[] {
    return this.allNearby;
  }
  get hasNearbyBags(): boolean {
    return this.nearby.length > 0;
  }
  get activeOrders(): readonly OrderRecord[] {
    return this.active;
  }
  get orderHistory(): readonly OrderRecord[] {
    return this.history;
  }
  get favoriteStores(): readonly FavoriteStore[] {
    return this.favStores;
  }
  isFavorite(id: string): boolean {
    return this.favIds.has(id);
  }
  get notifications(): readonly AppNotification[] {
    return this.notifs;
  }
  get unreadCount(): number {
    return this.notifs.filter((notification) => notification.unread).length;
  }
  get activeBags(): MerchantBag[] {
    return this.bags.filter((bag) => bag.active);
  }
  get inactiveBags(): MerchantBag[] {
    return this.bags.filter((bag) => !bag.active);
  }
  get allMerchantBags(): readonly MerchantBag[] {
    return this.bags;
  }
  get activeBagCount(): number {
    return this.activeBags.length;
  }
  get pendingOrders(): IncomingOrder[] {
    return this.incoming.filter((order) => order.status !== "redeemed" && order.status !== "cancelled" && order.status !== "expired");
  }
  get completedOrders(): IncomingOrder[] {
    return this.incoming.filter((order) => order.status === "redeemed" || order.status === "cancelled" || order.status === "expired");
  }
  get incomingOrders(): readonly IncomingOrder[] {
    return this.incoming;
  }
  get redeemedBagCount(): number {
    return this.incoming.reduce((total, order) => (order.status === "redeemed" ? total + order.bags : total), 0);
  }
  get pendingOrderCount(): number {
    return this.pendingOrders.length;
  }
  get merchantReviews(): readonly MerchantReview[] {
    return this.reviews;
  }
  get transactions(): readonly TxRecord[] {
    return this.tx;
  }
  get bankAccountRecords(): readonly BankAccount[] {
    return this.bankAccountList;
  }
  get bankAccounts(): string[] {
    return this.bankAccountList.map((account) => bankLabel(account));
  }
  get payoutRequests(): readonly PayoutRequest[] {
    return this.payouts;
  }
  get usesRemoteBackend(): boolean {
    return backend().isRemote;
  }

  get selectedBankAccount(): BankAccount | null {
    for (const account of this.bankAccountList) {
      if (bankLabel(account) === this.selectedBank) return account;
    }
    return this.bankAccountList[0] ?? null;
  }

  /** Web: the order with `id` from the cached lists (deep links). */
  findOrder(id: string): OrderRecord | null {
    return [...this.active, ...this.history].find((order) => order.id === id) ?? null;
  }

  /** Web: a cached nearby bag (deep links). */
  findBag(id: string): Bag | null {
    return this.allNearby.find((bag) => bag.id === id) ?? null;
  }

  /** Web: a cached merchant bag (deep links). */
  findMerchantBag(id: string): MerchantBag | null {
    return this.bags.find((bag) => bag.id === id) ?? null;
  }

  /** Web: a cached incoming order (deep links). */
  findIncomingOrder(id: string): IncomingOrder | null {
    return this.incoming.find((order) => order.id === id) ?? null;
  }

  /** Web: a cached payout request (deep links). */
  findPayoutRequest(id: string): PayoutRequest | null {
    return this.payouts.find((request) => request.id === id) ?? null;
  }

  // ── Local preferences ──────────────────────────────────────────────────

  restoreLocalState() {
    try {
      this.onboardingSeen = prefs.bool(KEYS.onboarding) ?? false;
      this.locationPrimed = prefs.bool(KEYS.locationPrimed) ?? false;
      this.location = prefs.get(KEYS.locationLabel) ?? this.location;
      this.userLatitude = prefs.num(KEYS.latitude);
      this.userLongitude = prefs.num(KEYS.longitude);
      if (!validCoordinates(this.userLatitude, this.userLongitude)) {
        this.userLatitude = null;
        this.userLongitude = null;
      }
      this.userLocationIsFromDevice =
        prefs.bool(KEYS.locationFromDevice) ?? (this.userLatitude !== null && this.location === "Sekitar saya");
      this.deviceLatitude = prefs.num(KEYS.deviceLatitude);
      this.deviceLongitude = prefs.num(KEYS.deviceLongitude);
      if (!validCoordinates(this.deviceLatitude, this.deviceLongitude)) {
        if (this.userLocationIsFromDevice) {
          this.deviceLatitude = this.userLatitude;
          this.deviceLongitude = this.userLongitude;
        } else {
          this.deviceLatitude = null;
          this.deviceLongitude = null;
        }
      }
      this.userLocationAccuracyMeters = this.deviceLatitude !== null ? prefs.num(KEYS.locationAccuracy) : null;
      this.userLocationAccuracyReduced = this.deviceLatitude !== null && (prefs.bool(KEYS.locationReducedAccuracy) ?? false);
      const storedMethod = prefs.get(KEYS.paymentMethod);
      this.defaultPaymentMethod = (PAYMENT_METHODS as readonly string[]).includes(storedMethod ?? "") ? (storedMethod as string) : "QRIS";
      const intent = prefs.get(KEYS.merchantIntent);
      this.pendingMerchantIntent = intent === "merchant" ? true : intent === "consumer" ? false : null;
      this.checkoutKeys = decodeStringMap(prefs.get(KEYS.checkoutIdempotency));
      this.checkoutOrderIds = decodeStringMap(prefs.get(KEYS.checkoutOrderIds));
      for (const signature of [...this.checkoutOrderIds.keys()]) {
        if (!this.checkoutKeys.has(signature)) this.checkoutOrderIds.delete(signature);
      }
      this.payoutKeys = decodeStringMap(prefs.get(KEYS.payoutIdempotency));
    } catch {
      // Local storage is not critical; the app keeps working without it.
    }
  }

  private persistIdempotencyKeys() {
    prefs.set(KEYS.checkoutIdempotency, encodeStringMap(this.checkoutKeys));
    prefs.set(KEYS.checkoutOrderIds, encodeStringMap(this.checkoutOrderIds));
    prefs.set(KEYS.payoutIdempotency, encodeStringMap(this.payoutKeys));
  }

  async markOnboardingSeen() {
    this.onboardingSeen = true;
    prefs.set(KEYS.onboarding, "true");
    this.notifyListeners();
  }

  async markLocationPrimed() {
    this.locationPrimed = true;
    prefs.set(KEYS.locationPrimed, "true");
    this.notifyListeners();
  }

  async setPendingMerchantIntent(merchant: boolean | null) {
    this.pendingMerchantIntent = merchant;
    if (merchant === null) prefs.remove(KEYS.merchantIntent);
    else prefs.set(KEYS.merchantIntent, merchant ? "merchant" : "consumer");
    this.notifyListeners();
  }

  consumePendingMerchantIntent(): boolean | null {
    const intent = this.pendingMerchantIntent;
    this.pendingMerchantIntent = null;
    prefs.remove(KEYS.merchantIntent);
    return intent;
  }

  // ── Location ───────────────────────────────────────────────────────────

  async determineLocation({ requestPermission: request = true }: { requestPermission?: boolean } = {}): Promise<boolean> {
    this.isDeterminingLocation = true;
    this.errorMessage = null;
    this.notifyListeners();
    if (!backend().isRemote) {
      this.locationServicesEnabled = true;
      this.hasLocationPermission = true;
      this.locationPermissionDeniedForever = false;
      await this.setLocationWithCoordinates("Margonda, Depok", -6.3725, 106.8323, { reload: false });
      await this.markLocationPrimed();
      await this.loadConsumerHome();
      this.isDeterminingLocation = false;
      this.notifyListeners();
      return true;
    }
    try {
      this.locationServicesEnabled = isLocationServiceEnabled();
      if (!this.locationServicesEnabled) {
        this.errorMessage = LocationPermissionSupport.locationServicesDisabledMessage();
        return false;
      }
      let permission = await checkPermission();
      if (permission === "denied" && request) permission = await requestPermission();
      this.hasLocationPermission = permission === "always" || permission === "whileInUse";
      this.locationPermissionDeniedForever = permission === "deniedForever";
      if (!this.hasLocationPermission) {
        this.errorMessage = this.browserLocationPermissionGuidance;
        return false;
      }
      const position = await getCurrentPosition();
      if (!validCoordinates(position.latitude, position.longitude)) {
        throw new BackendException("invalid_location", "Perangkat mengembalikan titik lokasi yang tidak valid.");
      }
      await this.setLocationWithCoordinates("Sekitar saya", position.latitude, position.longitude, {
        reload: false,
        fromDevice: true,
        accuracyMeters: position.accuracy > 0 ? position.accuracy : null,
        reducedAccuracy: false,
      });
      await this.markLocationPrimed();
      await this.loadConsumerHome();
      return true;
    } catch (error) {
      this.errorMessage = this.messageFor(error, "Lokasi tidak dapat dibaca. Coba lagi.");
      return false;
    } finally {
      this.isDeterminingLocation = false;
      this.notifyListeners();
    }
  }

  /** Reads the store's physical point without changing consumer discovery. */
  async determineStoreLocation({
    requestPermission: request = true,
  }: { requestPermission?: boolean } = {}): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
    this.isDeterminingLocation = true;
    this.errorMessage = null;
    this.notifyListeners();
    if (!backend().isRemote) {
      this.locationServicesEnabled = true;
      this.hasLocationPermission = true;
      this.locationPermissionDeniedForever = false;
      this.isDeterminingLocation = false;
      this.notifyListeners();
      return { latitude: -6.372, longitude: 106.8318, accuracy: 5 };
    }
    try {
      this.locationServicesEnabled = isLocationServiceEnabled();
      if (!this.locationServicesEnabled) {
        this.errorMessage = LocationPermissionSupport.locationServicesDisabledMessage();
        return null;
      }
      let permission = await checkPermission();
      if (permission === "denied" && request) permission = await requestPermission();
      this.hasLocationPermission = permission === "always" || permission === "whileInUse";
      this.locationPermissionDeniedForever = permission === "deniedForever";
      if (!this.hasLocationPermission) {
        this.errorMessage = this.browserLocationPermissionGuidance;
        return null;
      }
      const position = await getCurrentPosition();
      if (!validCoordinates(position.latitude, position.longitude)) {
        throw new BackendException("invalid_store_location", "Perangkat mengembalikan titik toko yang tidak valid.");
      }
      return { latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy };
    } catch (error) {
      this.errorMessage = this.messageFor(error, "Lokasi toko tidak dapat dibaca. Coba lagi.");
      return null;
    } finally {
      this.isDeterminingLocation = false;
      this.notifyListeners();
    }
  }

  openLocationSettings = () => LocationPermissionSupport.openSettings({ locationServicesEnabled: false });
  openAppSettings = () => LocationPermissionSupport.openSettings({ locationServicesEnabled: true });
  openRelevantLocationSettings = () =>
    LocationPermissionSupport.openSettings({ locationServicesEnabled: this.locationServicesEnabled });

  async setLocationWithCoordinates(
    label: string,
    latitude: number,
    longitude: number,
    {
      reload = true,
      fromDevice = false,
      accuracyMeters = null,
      reducedAccuracy = false,
    }: { reload?: boolean; fromDevice?: boolean; accuracyMeters?: number | null; reducedAccuracy?: boolean } = {},
  ) {
    if (!validCoordinates(latitude, longitude)) throw new Error("Koordinat lokasi tidak valid.");
    const locationChanged = this.userLatitude !== latitude || this.userLongitude !== longitude;
    this.location = label;
    this.userLatitude = latitude;
    this.userLongitude = longitude;
    this.userLocationIsFromDevice = fromDevice;
    if (fromDevice) {
      this.deviceLatitude = latitude;
      this.deviceLongitude = longitude;
      this.userLocationAccuracyMeters = accuracyMeters;
      this.userLocationAccuracyReduced = reducedAccuracy;
    }
    if (locationChanged) {
      // Never show cards from the old area under the new area's label while
      // the next request is still running or fails.
      this.generations.consumer++;
      this.isLoadingConsumer = reload;
      this.allNearby = [];
      this.nearby = [];
      this.loadErrors.delete("consumer");
    }
    this.notifyListeners();
    prefs.set(KEYS.locationLabel, label);
    prefs.set(KEYS.latitude, String(latitude));
    prefs.set(KEYS.longitude, String(longitude));
    prefs.set(KEYS.locationFromDevice, String(fromDevice));
    if (fromDevice) {
      prefs.set(KEYS.deviceLatitude, String(latitude));
      prefs.set(KEYS.deviceLongitude, String(longitude));
      if (accuracyMeters !== null) prefs.set(KEYS.locationAccuracy, String(accuracyMeters));
      else prefs.remove(KEYS.locationAccuracy);
      prefs.set(KEYS.locationReducedAccuracy, String(reducedAccuracy));
    }
    if (reload) await this.loadConsumerHome();
  }

  get hasValidUserLocation(): boolean {
    return validCoordinates(this.userLatitude, this.userLongitude);
  }

  get hasValidDeviceLocation(): boolean {
    return validCoordinates(this.deviceLatitude, this.deviceLongitude);
  }

  setLocation(value: string) {
    const point = CITY_COORDINATES[value];
    if (point) {
      void this.setLocationWithCoordinates(value, point[0], point[1]);
    } else {
      this.location = value;
      this.notifyListeners();
    }
  }

  async setBagFilter(filter: BagFilter) {
    this.currentFilter = filter;
    this.nearby = this.allNearby.filter((bag) => bagMatchesFilter(bag, filter));
    this.notifyListeners();
  }

  search(query: string): Promise<Bag[]> {
    return backend().searchBags(query.trim(), {
      latitude: this.userLatitude,
      longitude: this.userLongitude,
      filter: this.currentFilter,
    });
  }

  bagsByMerchant(id: string): Promise<Bag[]> {
    return backend().bagsByMerchant(id);
  }

  // ── Loaders ────────────────────────────────────────────────────────────

  async bootstrap() {
    const epoch = this.sessionEpoch;
    this.isBootstrapping = true;
    this.errorMessage = null;
    this.notifyListeners();
    try {
      const [profile, store, config, isAdmin] = await Promise.all([
        backend().currentProfile(),
        backend().myStore(),
        backend().businessConfig(),
        backend()
          .isAdmin()
          .catch(() => false),
      ]);
      if (epoch !== this.sessionEpoch) return;
      this.applyProfile(profile);
      this.applyStore(store);
      this.businessConfig = config;
      this.isAdmin = isAdmin;
      await this.startRealtime(epoch);
    } catch (error) {
      if (epoch === this.sessionEpoch) {
        this.errorMessage = this.messageFor(error);
        throw error;
      }
    } finally {
      if (epoch === this.sessionEpoch) {
        this.isBootstrapping = false;
        this.notifyListeners();
      }
    }
  }

  async loadProfile() {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.profile;
    this.clearLoadError("profile");
    try {
      const profile = await backend().currentProfile();
      if (epoch !== this.sessionEpoch || generation !== this.generations.profile) return;
      this.applyProfile(profile);
      this.notifyListeners();
    } catch (error) {
      if (generation === this.generations.profile) this.setLoadError("profile", error, epoch);
    }
  }

  async loadBusinessConfig() {
    const epoch = this.sessionEpoch;
    try {
      const config = await backend().businessConfig();
      if (epoch !== this.sessionEpoch) return;
      this.businessConfig = config;
      this.notifyListeners();
    } catch {
      // Migration defaults stay when the remote config is unreachable.
    }
  }

  async loadConsumerHome() {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.consumer;
    this.isLoadingConsumer = true;
    this.loadErrors.delete("consumer");
    this.notifyListeners();
    try {
      // Favourites are not critical to discovery: the bags must still load
      // when the favourites endpoint has a problem.
      const favoritesPromise = this.loadFavoriteMerchantIdsSafely();
      const bags = await backend().nearbyBags({
        latitude: this.userLatitude,
        longitude: this.userLongitude,
        filter: EMPTY_FILTER,
      });
      const favoriteIds = await favoritesPromise;
      if (epoch !== this.sessionEpoch || generation !== this.generations.consumer) return;
      this.allNearby = bags;
      this.nearby = bags.filter((bag) => bagMatchesFilter(bag, this.currentFilter));
      if (favoriteIds) this.favIds = favoriteIds;
    } catch (error) {
      if (generation === this.generations.consumer) this.setLoadError("consumer", error, epoch);
    } finally {
      if (epoch === this.sessionEpoch && generation === this.generations.consumer) {
        this.isLoadingConsumer = false;
        this.notifyListeners();
      }
    }
  }

  private async loadFavoriteMerchantIdsSafely(): Promise<Set<string> | null> {
    try {
      return await backend().favoriteMerchantIds();
    } catch {
      return null;
    }
  }

  async loadOrders() {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.orders;
    const checkoutKeysAtStart = new Map(this.checkoutKeys);
    const checkoutOrderIdsAtStart = new Map(this.checkoutOrderIds);
    this.isLoadingOrders = true;
    this.loadErrors.delete("orders");
    this.notifyListeners();
    try {
      // Complaint status is extra detail: orders must load without it.
      const [loadedActive, loadedHistory, loadedComplaints] = await Promise.all([
        backend().activeOrders(),
        backend().orderHistory(),
        backend()
          .myComplaints()
          .catch(() => this.complaints),
      ]);
      if (epoch !== this.sessionEpoch || generation !== this.generations.orders) return;
      this.complaints = loadedComplaints;
      this.active = loadedActive.filter((order) => !isTerminalFailure(order.paymentState));
      this.history = [...loadedHistory];
      for (const terminal of loadedActive.filter((order) => isTerminalFailure(order.paymentState))) {
        if (!this.history.some((order) => order.id === terminal.id)) this.history.push(terminal);
      }
      if (checkoutKeysAtStart.size) {
        for (const resolved of [...this.active, ...this.history].filter((order) => !isAwaitingCustomer(order.paymentState))) {
          const signature = this.checkoutSignatureForOrder(resolved);
          const expectedKey = checkoutKeysAtStart.get(signature);
          const expectedOrderId = checkoutOrderIdsAtStart.get(signature);
          if (expectedKey !== undefined && expectedOrderId === resolved.id) {
            this.clearCompletedCheckoutKey(resolved, { expectedKey, expectedOrderId });
          }
        }
      }
      if (backend().isRemote && this.active.some((order) => isAwaitingCustomer(order.paymentState))) {
        void this.syncPendingPayments(epoch);
      }
    } catch (error) {
      if (generation === this.generations.orders) this.setLoadError("orders", error, epoch);
    } finally {
      if (epoch === this.sessionEpoch && generation === this.generations.orders) {
        this.isLoadingOrders = false;
        this.notifyListeners();
      }
    }
  }

  async loadFavorites() {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.favorites;
    this.clearLoadError("favorites");
    try {
      const [ids, stores] = await Promise.all([backend().favoriteMerchantIds(), backend().favoriteStores()]);
      if (epoch !== this.sessionEpoch || generation !== this.generations.favorites) return;
      this.favIds = ids;
      this.favStores = stores;
      this.notifyListeners();
    } catch (error) {
      if (generation === this.generations.favorites) this.setLoadError("favorites", error, epoch);
    }
  }

  async loadNotifications() {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.notifications;
    this.isLoadingNotifications = true;
    this.loadErrors.delete("notifications");
    this.notifyListeners();
    try {
      const values = await backend().notifications();
      if (epoch !== this.sessionEpoch || generation !== this.generations.notifications) return;
      this.notifs = values;
    } catch (error) {
      if (generation === this.generations.notifications) this.setLoadError("notifications", error, epoch);
    } finally {
      if (epoch === this.sessionEpoch && generation === this.generations.notifications) {
        this.isLoadingNotifications = false;
        this.notifyListeners();
      }
    }
  }

  async loadStore() {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.store;
    this.clearLoadError("store");
    try {
      const store = await backend().myStore();
      if (epoch !== this.sessionEpoch || generation !== this.generations.store) return;
      this.applyStore(store);
      this.notifyListeners();
    } catch (error) {
      if (generation === this.generations.store) this.setLoadError("store", error, epoch);
    }
  }

  async loadMerchantData() {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.merchant;
    this.isLoadingMerchant = true;
    this.loadErrors.delete("merchant");
    this.notifyListeners();
    try {
      const [bags, incoming, stats] = await Promise.all([
        backend().myBags(),
        backend().incomingOrders(),
        backend().merchantStats(),
      ]);
      if (epoch !== this.sessionEpoch || generation !== this.generations.merchant) return;
      this.bags = bags;
      this.incoming = incoming;
      this.applyStats(stats);
    } catch (error) {
      if (generation === this.generations.merchant) this.setLoadError("merchant", error, epoch);
    } finally {
      if (epoch === this.sessionEpoch && generation === this.generations.merchant) {
        this.isLoadingMerchant = false;
        this.notifyListeners();
      }
    }
  }

  async loadMerchantReviews() {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.merchantReviews;
    this.isLoadingMerchantReviews = true;
    this.loadErrors.delete("merchantReviews");
    this.notifyListeners();
    try {
      const values = await backend().merchantReviews();
      if (epoch !== this.sessionEpoch || generation !== this.generations.merchantReviews) return;
      this.reviews = values;
    } catch (error) {
      if (generation === this.generations.merchantReviews) this.setLoadError("merchantReviews", error, epoch);
    } finally {
      if (epoch === this.sessionEpoch && generation === this.generations.merchantReviews) {
        this.isLoadingMerchantReviews = false;
        this.notifyListeners();
      }
    }
  }

  complaintFor(orderId: string): Complaint | null {
    return this.complaints.find((complaint) => complaint.orderId === orderId) ?? null;
  }

  async submitComplaint(order: OrderRecord, category: ComplaintCategory, description: string) {
    const complaint = await backend().submitComplaint(order, category, description);
    this.complaints = [complaint, ...this.complaints];
    this.notifyListeners();
  }

  // ── Admin ──────────────────────────────────────────────────────────────

  async loadAdminData() {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.admin;
    this.isLoadingAdmin = true;
    this.loadErrors.delete("admin");
    this.notifyListeners();
    try {
      const [stats, merchants, complaints] = await Promise.all([
        backend().adminStats(),
        backend().adminMerchants(),
        backend().adminComplaints(),
      ]);
      if (epoch !== this.sessionEpoch || generation !== this.generations.admin) return;
      this.adminStats = stats;
      this.adminMerchants = merchants;
      this.adminComplaints = complaints;
    } catch (error) {
      if (generation === this.generations.admin) this.setLoadError("admin", error, epoch);
    } finally {
      if (epoch === this.sessionEpoch && generation === this.generations.admin) {
        this.isLoadingAdmin = false;
        this.notifyListeners();
      }
    }
  }

  async loadAdminUsers(search?: string) {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.adminUsers;
    this.isLoadingAdminUsers = true;
    this.loadErrors.delete("adminUsers");
    this.notifyListeners();
    try {
      const users = await backend().adminUsers(search);
      if (epoch !== this.sessionEpoch || generation !== this.generations.adminUsers) return;
      this.adminUsers = users;
    } catch (error) {
      if (generation === this.generations.adminUsers) this.setLoadError("adminUsers", error, epoch);
    } finally {
      if (epoch === this.sessionEpoch && generation === this.generations.adminUsers) {
        this.isLoadingAdminUsers = false;
        this.notifyListeners();
      }
    }
  }

  async loadReport(from: string, to: string) {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.report;
    this.isLoadingReport = true;
    this.loadErrors.delete("report");
    this.notifyListeners();
    try {
      const report = await backend().transactionReport(from, to);
      if (epoch !== this.sessionEpoch || generation !== this.generations.report) return;
      this.report = report;
    } catch (error) {
      if (generation === this.generations.report) this.setLoadError("report", error, epoch);
    } finally {
      if (epoch === this.sessionEpoch && generation === this.generations.report) {
        this.isLoadingReport = false;
        this.notifyListeners();
      }
    }
  }

  async setMerchantVerification(merchantId: string, status: "verified" | "rejected", note?: string) {
    await backend().setMerchantVerification(merchantId, status, note);
    await this.loadAdminData();
  }

  async setUserSuspended(userId: string, suspended: boolean, reason?: string) {
    await backend().setUserSuspended(userId, suspended, reason);
    await Promise.all([this.loadAdminUsers(), this.loadAdminData()]);
  }

  async updateComplaint(complaintId: string, status: Exclude<ComplaintStatus, "open">, note?: string) {
    await backend().updateComplaint(complaintId, status, note);
    await this.loadAdminData();
  }

  async loadBalance() {
    const epoch = this.sessionEpoch;
    const generation = ++this.generations.balance;
    this.isLoadingBalance = true;
    this.loadErrors.delete("balance");
    this.notifyListeners();
    try {
      const [balance, transactions, accounts, payouts] = await Promise.all([
        backend().balance(),
        backend().transactions(),
        backend().bankAccounts(),
        backend().payoutRequests(),
      ]);
      if (epoch !== this.sessionEpoch || generation !== this.generations.balance) return;
      this.balance = balance;
      this.tx = transactions;
      this.bankAccountList = accounts;
      this.payouts = payouts;
      if (accounts.length && !accounts.some((account) => bankLabel(account) === this.selectedBank)) {
        const preferred = accounts.find((account) => account.isDefault) ?? accounts[0];
        this.selectedBank = bankLabel(preferred);
      }
    } catch (error) {
      if (generation === this.generations.balance) this.setLoadError("balance", error, epoch);
    } finally {
      if (epoch === this.sessionEpoch && generation === this.generations.balance) {
        this.isLoadingBalance = false;
        this.notifyListeners();
      }
    }
  }

  private async startRealtime(epoch: number) {
    this.cancelRealtime();
    if (epoch !== this.sessionEpoch) return;
    this.notificationSubscription = backend().watchNotifications(
      (values) => {
        if (epoch !== this.sessionEpoch) return;
        const previous = new Map(this.notifs.map((notification) => [notification.id, notification.unread]));
        const changed = values.filter(
          (notification) => !previous.has(notification.id) || previous.get(notification.id) !== notification.unread,
        );
        this.notifs = values;
        this.notifyListeners();
        const routes = changed.map((value) => value.route).filter((route): route is string => typeof route === "string");
        if (routes.some((route) => route === "orders" || route.startsWith("order:"))) void this.loadOrders();
        if (this.merchantSetupDone && routes.some(isMerchantOrdersNotificationRoute)) void this.loadMerchantData();
        if (this.merchantSetupDone && routes.includes("merchant_reviews")) void this.loadMerchantReviews();
        if (this.merchantSetupDone && routes.includes("merchant_balance")) void this.loadBalance();
        if (routes.includes("consumer_home")) void this.loadConsumerHome();
      },
      (error) => this.setLoadError("notifications", error, epoch),
    );
    if (!this.merchantSetupDone) return;
    this.incomingSubscription = backend().watchIncomingOrders(
      (values) => {
        if (epoch !== this.sessionEpoch) return;
        this.incoming = values;
        this.notifyListeners();
      },
      (error) => this.setLoadError("merchant", error, epoch),
    );
    this.transactionSubscription = backend().watchTransactions(
      (values) => {
        if (epoch !== this.sessionEpoch) return;
        this.tx = values;
        void backend()
          .balance()
          .then(
            (balance) => {
              if (epoch === this.sessionEpoch) this.balance = balance;
            },
            () => undefined,
          )
          .finally(() => {
            if (epoch === this.sessionEpoch) this.notifyListeners();
          });
      },
      (error) => this.setLoadError("balance", error, epoch),
    );
  }

  private cancelRealtime() {
    this.notificationSubscription?.();
    this.incomingSubscription?.();
    this.transactionSubscription?.();
    this.notificationSubscription = null;
    this.incomingSubscription = null;
    this.transactionSubscription = null;
  }

  // ── Consumer actions ───────────────────────────────────────────────────

  async toggleFavorite(merchantId: string): Promise<boolean> {
    const added = await backend().toggleFavorite(merchantId);
    if (added) this.favIds.add(merchantId);
    else this.favIds.delete(merchantId);
    this.favIds = new Set(this.favIds);
    this.notifyListeners();
    void this.loadFavorites();
    return added;
  }

  async placeOrder(bag: Bag, quantity: number, method: string, { idempotencyKey }: { idempotencyKey?: string | null } = {}) {
    const requestEpoch = this.sessionEpoch;
    // An old order's bag snapshot does not carry fresh stock; on the remote
    // backend PostgreSQL stays the authoritative stock validator.
    if (quantity < 1 || (!backend().isRemote && quantity > bag.quantityLeft)) {
      throw new BackendException("invalid_quantity", "Jumlah bag tidak sesuai stok yang tersedia.");
    }
    const signature = this.checkoutSignature(bag.id, quantity, method);
    const previousKey = this.checkoutKeys.get(signature);
    const key = idempotencyKey ?? previousKey ?? newUuid();
    if (previousKey !== undefined && previousKey !== key) this.checkoutOrderIds.delete(signature);
    this.checkoutKeys.set(signature, key);
    this.checkoutRequestsInFlight.set(signature, (this.checkoutRequestsInFlight.get(signature) ?? 0) + 1);
    try {
      // Persisted before the request so a retry after a reload reuses the key.
      this.persistIdempotencyKeys();
      const order = await backend().placeOrder(bag, quantity, method, key);
      this.cacheOrder(order);
      if (this.checkoutKeys.get(signature) === key) {
        if (isAwaitingCustomer(order.paymentState) && order.id) {
          this.checkoutOrderIds.set(signature, order.id);
        } else if (!isAwaitingCustomer(order.paymentState)) {
          this.checkoutKeys.delete(signature);
          this.checkoutOrderIds.delete(signature);
        }
        this.persistIdempotencyKeys();
      }
      this.notifyListeners();
      return order;
    } finally {
      if (requestEpoch === this.sessionEpoch) {
        const remaining = (this.checkoutRequestsInFlight.get(signature) ?? 1) - 1;
        if (remaining <= 0) this.checkoutRequestsInFlight.delete(signature);
        else this.checkoutRequestsInFlight.set(signature, remaining);
      }
    }
  }

  /**
   * Recovers an order that was committed while the create response was lost.
   * Matches the whole checkout signature and only accepts a payment state
   * that can continue or is verified paid.
   */
  async recoverCheckout(bag: Bag, quantity: number, method: string): Promise<OrderRecord | null> {
    const orders = await backend().activeOrders();
    const candidates = orders
      .filter(
        (order) =>
          order.bag.id === bag.id &&
          order.quantity === quantity &&
          order.paymentMethod === method &&
          (isAwaitingCustomer(order.paymentState) || isPaid(order.paymentState)),
      )
      .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));
    if (!candidates.length) return null;
    const recovered: OrderRecord = { ...candidates[0], bag };
    this.cacheOrder(recovered);
    if (recovered.id) {
      this.checkoutOrderIds.set(this.checkoutSignature(bag.id, quantity, method), recovered.id);
      this.persistIdempotencyKeys();
    }
    this.notifyListeners();
    return recovered;
  }

  /**
   * Explicit sync after the customer finishes scanning QRIS. The UI is never
   * proof of payment; the backend asks the provider first.
   */
  async refreshPayment(order: OrderRecord): Promise<OrderRecord> {
    const epoch = this.sessionEpoch;
    const refreshed = await backend().refreshPayment(order);
    if (epoch !== this.sessionEpoch) return refreshed;
    this.cacheOrder(refreshed);
    this.clearCompletedCheckoutKey(refreshed);
    this.notifyListeners();
    return refreshed;
  }

  private async syncPendingPayments(epoch: number) {
    if (this.isSyncingPendingPayments || epoch !== this.sessionEpoch) return;
    this.isSyncingPendingPayments = true;
    try {
      const pending = this.active.filter((order) => isAwaitingCustomer(order.paymentState)).slice(0, 5);
      for (const order of pending) {
        if (epoch !== this.sessionEpoch) return;
        try {
          const refreshed = await backend().refreshPayment(order);
          if (epoch !== this.sessionEpoch) return;
          this.cacheOrder(refreshed);
          this.clearCompletedCheckoutKey(refreshed);
        } catch {
          // The list stays usable while the provider is unreachable; the user
          // can check the status manually.
        }
      }
      if (epoch === this.sessionEpoch) this.notifyListeners();
    } finally {
      this.isSyncingPendingPayments = false;
    }
  }

  private cacheOrder(order: OrderRecord) {
    this.active = this.active.filter((item) => item.id !== order.id);
    this.history = this.history.filter((item) => item.id !== order.id);
    if (
      order.status === "done" ||
      order.status === "cancelled" ||
      order.status === "expired" ||
      isTerminalFailure(order.paymentState)
    ) {
      this.history = [order, ...this.history];
    } else {
      this.active = [order, ...this.active];
    }
  }

  private checkoutSignature(bagId: string, quantity: number, method: string) {
    return `${bagId}|${quantity}|${method}`;
  }

  private checkoutSignatureForOrder(order: OrderRecord) {
    return this.checkoutSignature(order.bag.id, order.quantity, order.paymentMethod);
  }

  private clearCompletedCheckoutKey(
    order: OrderRecord,
    { expectedKey, expectedOrderId }: { expectedKey?: string; expectedOrderId?: string } = {},
  ) {
    if (isAwaitingCustomer(order.paymentState)) return;
    const signature = this.checkoutSignatureForOrder(order);
    const associated = this.checkoutOrderIds.get(signature);
    if (associated === undefined || associated !== order.id) return;
    if (expectedOrderId !== undefined && associated !== expectedOrderId) return;
    if ((this.checkoutRequestsInFlight.get(signature) ?? 0) > 0) return;
    if (this.active.some((active) => isAwaitingCustomer(active.paymentState) && this.checkoutSignatureForOrder(active) === signature)) {
      return;
    }
    if (expectedKey !== undefined && this.checkoutKeys.get(signature) !== expectedKey) return;
    if (!this.checkoutKeys.delete(signature)) return;
    this.checkoutOrderIds.delete(signature);
    this.persistIdempotencyKeys();
  }

  async issuePickupToken(order: OrderRecord): Promise<OrderRecord> {
    const refreshed = await backend().issuePickupToken(order);
    this.active = this.active.map((item) => (item.id === order.id ? refreshed : item));
    this.history = this.history.map((item) => (item.id === order.id ? refreshed : item));
    this.notifyListeners();
    return refreshed;
  }

  async submitReview(order: OrderRecord, rating: number, tags: string[], comment: string) {
    await backend().submitReview(order, rating, tags, comment);
    this.history = this.history.map((item) => (item.id === order.id ? { ...item, reviewed: true, canRate: false } : item));
    this.notifyListeners();
  }

  // ── Merchant actions ───────────────────────────────────────────────────

  async addBag(input: BagInput) {
    await backend().addBag(input);
    void this.loadMerchantData();
  }

  async updateBag(bag: MerchantBag, input: BagInput) {
    await backend().updateBag(bag, input);
    void this.loadMerchantData();
  }

  async toggleBagActive(bag: MerchantBag) {
    await backend().setBagActive(bag, !bag.active);
    this.bags = this.bags.map((item) => (item.id === bag.id ? { ...bag, active: !bag.active } : item));
    this.notifyListeners();
    void this.loadMerchantData();
  }

  async duplicateBag(bag: MerchantBag) {
    await backend().duplicateBag(bag);
    void this.loadMerchantData();
  }

  async markOrderReady(orderId: string) {
    await backend().markOrderReady(orderId);
    this.incoming = this.incoming.map((order) =>
      order.id === orderId ? copyIncomingOrder(order, { status: "ready", needsAction: false }) : order,
    );
    this.notifyListeners();
    void this.loadMerchantData();
    void this.loadOrders();
  }

  async cancelMerchantOrder(orderId: string): Promise<IncomingOrder> {
    const cancelled = await backend().cancelMerchantOrder(orderId);
    const index = this.incoming.findIndex((order) => order.id === cancelled.id);
    this.incoming = index >= 0 ? this.incoming.map((order, i) => (i === index ? cancelled : order)) : [cancelled, ...this.incoming];
    const consumerOrder = this.active.find((order) => order.id === cancelled.id);
    if (consumerOrder) {
      this.active = this.active.filter((order) => order.id !== cancelled.id);
      this.history = [{ ...consumerOrder, status: "cancelled", canRate: false, pickupToken: null }, ...this.history];
    }
    this.notifyListeners();
    void this.loadMerchantData();
    void this.loadOrders();
    void this.loadConsumerHome();
    return cancelled;
  }

  async redeemOrder(pickupToken: string): Promise<IncomingOrder | null> {
    const order = await backend().redeemOrder(pickupToken);
    if (order) {
      const index = this.incoming.findIndex((item) => item.id === order.id);
      this.incoming = index >= 0 ? this.incoming.map((item, i) => (i === index ? order : item)) : [order, ...this.incoming];
    }
    this.notifyListeners();
    void this.loadMerchantData();
    void this.loadBalance();
    void this.loadOrders();
    return order;
  }

  async saveBankAccount(input: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountHolder: string;
    idempotencyKey?: string;
  }): Promise<BankAccount> {
    const account = await backend().saveBankAccount({ ...input, idempotencyKey: input.idempotencyKey ?? newUuid() });
    this.bankAccountList = [account, ...this.bankAccountList.filter((item) => item.id !== account.id)];
    this.selectedBank = bankLabel(account);
    this.notifyListeners();
    void this.loadBalance();
    return account;
  }

  async withdraw(amount: number, { idempotencyKey }: { idempotencyKey?: string } = {}): Promise<PayoutRequest> {
    if (!this.businessConfig.payoutsEnabled) {
      throw new BackendException("payout_disabled", "Fitur penarikan dana belum diaktifkan oleh operator.");
    }
    const account = this.selectedBankAccount;
    if (!account) throw new BackendException("bank_required", "Tambahkan rekening bank sebelum menarik saldo.");
    const signature = `${account.id}|${amount}`;
    const key = idempotencyKey ?? this.payoutKeys.get(signature) ?? newUuid();
    this.payoutKeys.set(signature, key);
    this.persistIdempotencyKeys();
    const request = await backend().requestPayout({ amount, bankAccountId: account.id, idempotencyKey: key });
    if (this.payoutKeys.get(signature) === key) {
      this.payoutKeys.delete(signature);
      this.persistIdempotencyKeys();
    }
    this.payouts = [request, ...this.payouts];
    this.notifyListeners();
    void this.loadBalance();
    return request;
  }

  async markAllNotificationsRead() {
    await backend().markAllNotificationsRead();
    this.notifs = this.notifs.map((notification) => ({ ...notification, unread: false }));
    this.notifyListeners();
    void this.loadNotifications();
  }

  async updateProfile(fields: { name?: string; email?: string; phone?: string; avatarUrl?: string }) {
    await backend().updateProfile(fields);
    if (fields.name !== undefined && fields.name.trim()) this.userName = fields.name.trim();
    if (fields.phone !== undefined) this.userPhone = fields.phone.trim();
    if (fields.avatarUrl !== undefined) this.userAvatarUrl = fields.avatarUrl;
    this.notifyListeners();
    void this.loadProfile();
  }

  async updateStore(fields: {
    name?: string;
    category?: string;
    address?: string;
    open?: string;
    close?: string;
    description?: string;
    logoUrl?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }) {
    const latitude = fields.latitude ?? this.storeLatitude;
    const longitude = fields.longitude ?? this.storeLongitude;
    if (!validCoordinates(latitude, longitude)) {
      throw new BackendException("invalid_store_location", "Alamat toko harus memiliki titik peta yang valid.");
    }
    await backend().upsertStore({
      name: fields.name ?? this.storeName,
      category: fields.category ?? this.storeCategory,
      address: fields.address ?? this.storeAddress,
      open: fields.open ?? this.openTime,
      close: fields.close ?? this.closeTime,
      description: fields.description ?? this.storeDescription,
      logoUrl: fields.logoUrl ?? this.storeLogoUrl,
      latitude,
      longitude,
    });
    this.merchantSetupDone = true;
    if (fields.name !== undefined && fields.name.trim()) this.storeName = fields.name.trim();
    if (fields.category !== undefined) this.storeCategory = fields.category;
    if (fields.address !== undefined && fields.address.trim()) this.storeAddress = fields.address.trim();
    if (fields.open !== undefined) this.openTime = fields.open;
    if (fields.close !== undefined) this.closeTime = fields.close;
    if (fields.description !== undefined) this.storeDescription = fields.description;
    if (fields.logoUrl) this.storeLogoUrl = fields.logoUrl;
    this.storeLatitude = latitude;
    this.storeLongitude = longitude;
    await this.startRealtime(this.sessionEpoch);
    this.notifyListeners();
  }

  /**
   * Opens the image picker and uploads. Call it first thing in a tap handler:
   * the browser only shows the file chooser during the user's gesture.
   */
  uploadImage(bucket: BackendBucket): Promise<string | null> {
    return backend().uploadImage(bucket);
  }

  uploadImageBytes(bucket: BackendBucket, bytes: Uint8Array, filename: string): Promise<string | null> {
    return backend().uploadImageBytes(bucket, bytes, filename);
  }

  setDefaultPaymentMethod(method: string) {
    const supported = (PAYMENT_METHODS as readonly string[]).includes(method) ? method : "QRIS";
    this.defaultPaymentMethod = supported;
    prefs.set(KEYS.paymentMethod, supported);
    this.notifyListeners();
  }

  async setBankAccount(account: BankAccount) {
    await backend().setDefaultBankAccount(account.id);
    this.bankAccountList = this.bankAccountList.map((item) => ({ ...item, isDefault: item.id === account.id }));
    this.selectedBank = bankLabel(account);
    this.notifyListeners();
  }

  rememberMode(value: string) {
    this.lastMode = value;
    void backend()
      .setLastMode(value)
      .catch(() => {
        // The mode preference is best effort.
      });
  }

  switchToMerchant() {
    this.mode = "merchant";
    this.notifyListeners();
  }

  switchToConsumer() {
    this.mode = "consumer";
    this.notifyListeners();
  }

  async deleteAccount() {
    await backend().deleteAccount();
    await this.clearSessionState();
  }

  async clearSessionState({ notify = true }: { notify?: boolean } = {}) {
    this.sessionEpoch++;
    this.invalidateLoadRequests();
    this.cancelRealtime();
    try {
      backend().clearSessionCache();
    } catch {
      // No backend selected yet (startup error): nothing to clear.
    }
    this.checkoutKeys.clear();
    this.checkoutOrderIds.clear();
    this.checkoutRequestsInFlight.clear();
    this.payoutKeys.clear();
    this.isSyncingPendingPayments = false;
    for (const key of [
      KEYS.checkoutIdempotency,
      KEYS.checkoutOrderIds,
      KEYS.payoutIdempotency,
      KEYS.locationPrimed,
      KEYS.locationLabel,
      KEYS.latitude,
      KEYS.longitude,
      KEYS.locationFromDevice,
      KEYS.deviceLatitude,
      KEYS.deviceLongitude,
      KEYS.locationAccuracy,
      KEYS.locationReducedAccuracy,
      KEYS.paymentMethod,
    ]) {
      prefs.remove(key);
    }
    this.pendingMerchantIntent = null;
    this.mode = "consumer";
    this.lastMode = "consumer";
    this.locationPrimed = false;
    this.location = "Lokasi belum dipilih";
    this.userLatitude = null;
    this.userLongitude = null;
    this.userLocationIsFromDevice = false;
    this.deviceLatitude = null;
    this.deviceLongitude = null;
    this.userLocationAccuracyMeters = null;
    this.userLocationAccuracyReduced = false;
    this.hasLocationPermission = false;
    this.locationPermissionDeniedForever = false;
    this.locationServicesEnabled = true;
    this.currentFilter = EMPTY_FILTER;
    this.defaultPaymentMethod = "QRIS";
    this.merchantSetupDone = false;
    this.userName = "Pengguna";
    this.userEmail = "";
    this.userPhone = "";
    this.userAvatarUrl = null;
    this.storeName = "";
    this.storeCategory = "Bakery";
    this.storeAddress = "";
    this.openTime = "08.00";
    this.closeTime = "21.00";
    this.storeDescription = "";
    this.storeLogoUrl = null;
    this.storeLatitude = null;
    this.storeLongitude = null;
    this.allNearby = [];
    this.nearby = [];
    this.favIds = new Set();
    this.favStores = [];
    this.active = [];
    this.history = [];
    this.notifs = [];
    this.bags = [];
    this.incoming = [];
    this.reviews = [];
    this.tx = [];
    this.bankAccountList = [];
    this.payouts = [];
    this.selectedBank = "";
    this.businessConfig = DEFAULT_BUSINESS_CONFIG;
    this.balance = 0;
    this.bagsSoldToday = 0;
    this.incomeToday = 0;
    this.incomeThisMonth = 0;
    this.foodSavedKg = 0;
    this.isAdmin = false;
    this.accountSuspended = false;
    this.suspendedReason = null;
    this.storeVerification = "verified";
    this.storeVerificationNote = null;
    this.complaints = [];
    this.adminStats = EMPTY_ADMIN_STATS;
    this.adminMerchants = [];
    this.adminUsers = [];
    this.adminComplaints = [];
    this.report = null;
    this.resetLoadingState();
    this.errorMessage = null;
    this.loadErrors.clear();
    await this.setPendingMerchantIntent(null);
    if (notify) this.notifyListeners();
  }

  clearError() {
    if (this.errorMessage === null) return;
    this.errorMessage = null;
    this.notifyListeners();
  }

  reportError(error: unknown) {
    this.setError(error, this.sessionEpoch);
  }

  private applyProfile(profile: Profile | null) {
    if (!profile) return;
    this.userName = profile.name;
    this.userEmail = profile.email;
    this.userPhone = profile.phone;
    this.userAvatarUrl = profile.avatarUrl;
    this.lastMode = profile.lastMode;
    this.accountSuspended = profile.suspendedAt !== null;
    this.suspendedReason = profile.suspendedReason;
  }

  private applyStore(store: StoreProfile | null) {
    this.merchantSetupDone = store !== null;
    if (!store) return;
    this.storeName = store.name;
    this.storeCategory = store.category;
    this.storeAddress = store.address;
    this.openTime = store.openTime;
    this.closeTime = store.closeTime;
    this.storeDescription = store.description;
    this.storeLogoUrl = store.logoUrl;
    this.storeLatitude = store.latitude;
    this.storeLongitude = store.longitude;
    this.storeVerification = store.verificationStatus;
    this.storeVerificationNote = store.verificationNote;
  }

  private applyStats(stats: MerchantStats) {
    this.bagsSoldToday = stats.bagsSoldToday;
    this.incomeToday = stats.incomeToday;
    this.incomeThisMonth = stats.incomeThisMonth;
    this.foodSavedKg = stats.foodSavedKg;
  }

  private setError(error: unknown, epoch: number) {
    if (epoch !== this.sessionEpoch) return;
    this.errorMessage = this.messageFor(error);
    this.notifyListeners();
  }

  private setLoadError(scope: LoadScope, error: unknown, epoch: number) {
    if (epoch !== this.sessionEpoch) return;
    this.loadErrors.set(scope, this.messageFor(error));
    this.notifyListeners();
  }

  private clearLoadError(scope: LoadScope) {
    if (this.loadErrors.delete(scope)) this.notifyListeners();
  }

  private invalidateLoadRequests() {
    for (const scope of Object.keys(this.generations) as LoadScope[]) this.generations[scope]++;
  }

  private resetLoadingState() {
    this.isBootstrapping = false;
    this.isLoadingConsumer = false;
    this.isLoadingOrders = false;
    this.isLoadingMerchant = false;
    this.isLoadingMerchantReviews = false;
    this.isLoadingBalance = false;
    this.isLoadingNotifications = false;
    this.isLoadingAdmin = false;
    this.isLoadingAdminUsers = false;
    this.isLoadingReport = false;
    this.isDeterminingLocation = false;
  }

  /** Dart `_messageFor`: domain messages pass through, anything else is generic. */
  messageFor(error: unknown, fallback = "Terjadi kendala. Silakan coba lagi."): string {
    if (error instanceof BackendException) return error.message;
    if (error instanceof LocationError) return fallback;
    if (process.env.NODE_ENV !== "production") console.warn("SaveBite error:", error);
    return fallback;
  }
}

/** The app's single state instance (Dart's top-level `appState`). */
export const appState = new AppState();
