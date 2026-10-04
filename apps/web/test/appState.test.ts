// @vitest-environment jsdom
/**
 * Port of `test/app_state_test.dart` (the web `AppState` over FakeBackend),
 * plus the AppState behaviour the screens depend on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppState, newUuid } from "../lib/appState";
import { FakeBackend } from "../lib/backend/fake";
import { BackendException, DEFAULT_BUSINESS_CONFIG } from "../lib/backend/types";
import { LocationError } from "../lib/location";
import { EMPTY_FILTER, orderRecord, type Bag, type OrderRecord } from "../lib/models";
import { backendError, flush, resetSession, useBackend } from "./support/harness";

class CommitThenLoseResponseBackend extends FakeBackend {
  private lostFirstResponse = false;

  override async placeOrder(bag: Bag, qty: number, method: string, idempotencyKey: string): Promise<OrderRecord> {
    const order = await super.placeOrder(bag, qty, method, idempotencyKey);
    if (!this.lostFirstResponse) {
      this.lostFirstResponse = true;
      throw new BackendException("network_lost", "Respons hilang setelah transaksi tersimpan.");
    }
    return order;
  }
}

class CheckoutProbeBackend extends FakeBackend {
  readonly keys: string[] = [];
  createCalls = 0;

  override async placeOrder(bag: Bag, qty: number, method: string, idempotencyKey: string): Promise<OrderRecord> {
    this.createCalls++;
    this.keys.push(idempotencyKey);
    const order = await super.placeOrder(bag, qty, method, idempotencyKey);
    return { ...order, paymentState: "pending" };
  }
}

class PendingWithMatchingHistoryBackend extends FakeBackend {
  override readonly isRemote = true;
  readonly keys: string[] = [];
  private pending: OrderRecord | null = null;
  private bag: Bag | null = null;

  override async placeOrder(bag: Bag, qty: number, method: string, idempotencyKey: string): Promise<OrderRecord> {
    this.keys.push(idempotencyKey);
    this.bag = bag;
    this.pending ??= orderRecord({
      id: "pending-repeat-order",
      bag,
      code: "SB-PENDING",
      dateLabel: "Hari ini",
      amount: bag.salePrice * qty + 1000,
      status: "pending",
      quantity: qty,
      paymentMethod: method,
      paymentState: "pending",
    });
    return this.pending;
  }

  override async activeOrders(): Promise<OrderRecord[]> {
    return this.pending ? [this.pending] : [];
  }

  override async orderHistory(): Promise<OrderRecord[]> {
    const bag = this.bag;
    if (!bag) return [];
    return [
      orderRecord({
        id: "older-completed-order",
        bag,
        code: "SB-OLD",
        dateLabel: "Kemarin",
        amount: bag.salePrice + 1000,
        status: "done",
        quantity: 1,
        paymentMethod: "Midtrans",
        paymentState: "paid",
      }),
    ];
  }
}

class AmbiguousWithMatchingHistoryBackend extends FakeBackend {
  override readonly isRemote = true;
  readonly keys: string[] = [];
  private bag: Bag | null = null;
  private committedKey: string | null = null;
  private committed: OrderRecord | null = null;
  private committedVisible = false;
  private committedResolved = false;
  private freshOrderNumber = 0;

  private pendingOrder(bag: Bag, qty: number, method: string, id: string): OrderRecord {
    return orderRecord({
      id,
      bag,
      code: `SB-${id.toUpperCase()}`,
      dateLabel: "Hari ini",
      amount: bag.salePrice * qty + 1000,
      status: "pending",
      quantity: qty,
      paymentMethod: method,
      paymentState: "pending",
    });
  }

  override async placeOrder(bag: Bag, qty: number, method: string, idempotencyKey: string): Promise<OrderRecord> {
    this.keys.push(idempotencyKey);
    this.bag = bag;
    if (this.committedKey === null) {
      this.committedKey = idempotencyKey;
      this.committed = this.pendingOrder(bag, qty, method, "ambiguous-order");
      throw new BackendException("response_lost", "Respons hilang sementara server masih menyelesaikan order.");
    }
    if (idempotencyKey === this.committedKey && this.committed) {
      this.committedVisible = true;
      return this.committed;
    }
    this.freshOrderNumber++;
    return this.pendingOrder(bag, qty, method, `fresh-order-${this.freshOrderNumber}`);
  }

  resolveCommittedOrder() {
    this.committedResolved = true;
    this.committedVisible = false;
    if (this.committed) this.committed = { ...this.committed, status: "done", paymentState: "paid" };
  }

  override async activeOrders(): Promise<OrderRecord[]> {
    return this.committedVisible && !this.committedResolved && this.committed ? [this.committed] : [];
  }

  override async orderHistory(): Promise<OrderRecord[]> {
    const bag = this.bag;
    if (!bag) return [];
    return [
      orderRecord({
        id: "unrelated-old-order",
        bag,
        code: "SB-UNRELATED",
        dateLabel: "Minggu lalu",
        amount: bag.salePrice + 1000,
        status: "done",
        quantity: 1,
        paymentMethod: "Midtrans",
        paymentState: "paid",
      }),
      ...(this.committedResolved && this.committed ? [this.committed] : []),
    ];
  }
}

async function firstNearbyBag(backend: FakeBackend): Promise<Bag> {
  const [bag] = await backend.nearbyBags();
  return bag;
}

let appState: AppState;
const states: AppState[] = [];

/** A fresh state that is cleaned up after the test (cancels realtime). */
function track(state: AppState): AppState {
  states.push(state);
  return state;
}

beforeEach(() => {
  localStorage.clear();
  appState = track(resetSession());
});

afterEach(async () => {
  for (const state of states.splice(0)) await state.clearSessionState({ notify: false });
  await flush();
  vi.unstubAllGlobals();
});

describe("app_state_test", () => {
  it("lokasi FakeBackend berhasil tanpa memanggil platform GPS", async () => {
    const getCurrentPosition = vi.fn();
    const query = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition }, permissions: { query } });

    const success = await appState.determineLocation();

    expect(success).toBe(true);
    expect(appState.locationPrimed).toBe(true);
    expect(appState.hasLocationPermission).toBe(true);
    expect(appState.location).toBe("Margonda, Depok");
    expect(appState.userLatitude).toBeCloseTo(-6.3725, 4);
    expect(appState.userLongitude).toBeCloseTo(106.8323, 4);
    expect(appState.nearbyBags.length).toBeGreaterThan(0);
    expect(appState.errorMessage).toBeNull();
    expect(appState.isDeterminingLocation).toBe(false);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("area pencarian tidak menimpa posisi fisik perangkat", async () => {
    const state = track(new AppState());
    state.restoreLocalState();
    await state.setLocationWithCoordinates("Sekitar saya", -6.201, 106.817, {
      reload: false,
      fromDevice: true,
      accuracyMeters: 18,
    });

    await state.setLocationWithCoordinates("Area peta", -6.3725, 106.8323, { reload: false });

    expect(state.userLocationIsFromDevice).toBe(false);
    expect(state.userLatitude).toBeCloseTo(-6.3725, 4);
    expect(state.userLongitude).toBeCloseTo(106.8323, 4);
    expect(state.deviceLatitude).toBeCloseTo(-6.201, 4);
    expect(state.deviceLongitude).toBeCloseTo(106.817, 4);
    expect(state.userLocationAccuracyMeters).toBe(18);

    const restored = track(new AppState());
    restored.restoreLocalState();
    expect(restored.location).toBe("Area peta");
    expect(restored.userLatitude).toBeCloseTo(-6.3725, 4);
    expect(restored.deviceLatitude).toBeCloseTo(-6.201, 4);
    expect(restored.deviceLongitude).toBeCloseTo(106.817, 4);
    expect(restored.userLocationAccuracyMeters).toBe(18);
  });

  it("profil toko menolak koordinat peta yang tidak valid", async () => {
    const error = await backendError(appState.updateStore({ latitude: 0, longitude: 0 }));
    expect(error.code).toBe("invalid_store_location");
    expect(error.message).toBe("Alamat toko harus memiliki titik peta yang valid.");
  });

  it("clearSessionState menghapus seluruh cache dan identitas sesi", async () => {
    await Promise.all([
      appState.loadConsumerHome(),
      appState.loadOrders(),
      appState.loadFavorites(),
      appState.loadNotifications(),
      appState.loadMerchantData(),
      appState.loadMerchantReviews(),
      appState.loadBalance(),
    ]);
    await appState.updateProfile({ name: "Akun Lama" });
    await appState.updateStore({
      name: "Toko Lama",
      category: "Bakery",
      address: "Alamat lama",
      open: "08.00",
      close: "20.00",
    });
    await appState.setLocationWithCoordinates("Lokasi Akun Lama", -6.2, 106.8, { fromDevice: true, accuracyMeters: 12 });
    await appState.markLocationPrimed();
    appState.setDefaultPaymentMethod("OVO");
    appState.switchToMerchant();

    expect(appState.nearbyBags.length).toBeGreaterThan(0);
    expect(appState.activeOrders.length).toBeGreaterThan(0);
    expect(appState.favoriteStores.length).toBeGreaterThan(0);
    expect(appState.notifications.length).toBeGreaterThan(0);
    expect(appState.activeBags.length).toBeGreaterThan(0);
    expect(appState.pendingOrders.length).toBeGreaterThan(0);
    expect(appState.merchantReviews.length).toBeGreaterThan(0);
    expect(appState.transactions.length).toBeGreaterThan(0);
    expect(appState.bankAccountRecords.length).toBeGreaterThan(0);
    expect(appState.merchantSetupDone).toBe(true);

    await appState.clearSessionState();

    expect(appState.mode).toBe("consumer");
    expect(appState.userName).toBe("Pengguna");
    expect(appState.userEmail).toBe("");
    expect(appState.userPhone).toBe("");
    expect(appState.storeName).toBe("");
    expect(appState.merchantSetupDone).toBe(false);
    expect(appState.nearbyBags).toEqual([]);
    expect(appState.activeOrders).toEqual([]);
    expect(appState.orderHistory).toEqual([]);
    expect(appState.favoriteStores).toEqual([]);
    expect(appState.notifications).toEqual([]);
    expect(appState.activeBags).toEqual([]);
    expect(appState.inactiveBags).toEqual([]);
    expect(appState.pendingOrders).toEqual([]);
    expect(appState.completedOrders).toEqual([]);
    expect(appState.merchantReviews).toEqual([]);
    expect(appState.transactions).toEqual([]);
    expect(appState.bankAccountRecords).toEqual([]);
    expect(appState.payoutRequests).toEqual([]);
    expect(appState.balance).toBe(0);
    expect(appState.pendingMerchantIntent).toBeNull();
    expect(appState.locationPrimed).toBe(false);
    expect(appState.location).toBe("Lokasi belum dipilih");
    expect(appState.userLatitude).toBeNull();
    expect(appState.userLongitude).toBeNull();
    expect(appState.deviceLatitude).toBeNull();
    expect(appState.deviceLongitude).toBeNull();
    expect(appState.defaultPaymentMethod).toBe("QRIS");

    const restoredForNextAccount = track(new AppState());
    restoredForNextAccount.restoreLocalState();
    expect(restoredForNextAccount.locationPrimed).toBe(false);
    expect(restoredForNextAccount.userLatitude).toBeNull();
    expect(restoredForNextAccount.deviceLatitude).toBeNull();
    expect(restoredForNextAccount.defaultPaymentMethod).toBe("QRIS");
  });

  it("idempotency checkout bertahan setelah AppState dibuat ulang", async () => {
    const backend = useBackend(new CommitThenLoseResponseBackend());
    const firstState = track(new AppState());
    firstState.restoreLocalState();
    const bag = await firstNearbyBag(backend);

    expect(await backendError(firstState.placeOrder(bag, 1, "Midtrans"))).toBeInstanceOf(BackendException);
    const afterCommit = await backend.activeOrders();

    const restartedState = track(new AppState());
    restartedState.restoreLocalState();
    const recovered = await restartedState.placeOrder(bag, 1, "Midtrans");
    const afterRetry = await backend.activeOrders();

    expect(recovered.id).toBe(afterCommit[0].id);
    expect(afterRetry).toHaveLength(afterCommit.length);
  });

  it("checkout tetap memanggil backend ketika persistence lokal gagal", async () => {
    const backend = useBackend(new CheckoutProbeBackend());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("local storage unavailable");
    });
    const state = track(new AppState());
    const bag = await firstNearbyBag(backend);

    const first = await state.placeOrder(bag, 1, "Midtrans");
    const retry = await state.placeOrder(bag, 1, "Midtrans");

    expect(backend.createCalls).toBe(2);
    expect(backend.keys).toHaveLength(2);
    expect(backend.keys[1]).toBe(backend.keys[0]);
    expect(retry.id).toBe(first.id);
  });

  it("checkout dapat memperbarui cache hasil loadOrders yang fixed-length", async () => {
    const backend = useBackend(new CheckoutProbeBackend());
    const state = track(new AppState());
    const bag = await firstNearbyBag(backend);

    await state.loadOrders();
    const order = await state.placeOrder(bag, 1, "Midtrans");

    expect(backend.createCalls).toBe(1);
    expect(state.activeOrders.some((item) => item.id === order.id)).toBe(true);
  });

  it("riwayat dengan signature sama tidak menghapus key order yang masih pending", async () => {
    const backend = useBackend(new PendingWithMatchingHistoryBackend());
    const firstState = track(new AppState());
    firstState.restoreLocalState();
    const bag = await firstNearbyBag(backend);

    await firstState.placeOrder(bag, 1, "Midtrans");
    await firstState.loadOrders();

    const restartedState = track(new AppState());
    restartedState.restoreLocalState();
    await restartedState.placeOrder(bag, 1, "Midtrans");

    expect(backend.keys).toHaveLength(2);
    expect(backend.keys[1]).toBe(backend.keys[0]);
  });

  it("respons ambigu tidak dikaitkan ke riwayat lama dan exact order membersihkan key", async () => {
    const backend = useBackend(new AmbiguousWithMatchingHistoryBackend());
    const firstState = track(new AppState());
    firstState.restoreLocalState();
    const bag = await firstNearbyBag(backend);

    expect(await backendError(firstState.placeOrder(bag, 1, "Midtrans"))).toBeInstanceOf(BackendException);
    await firstState.loadOrders();

    const retryState = track(new AppState());
    retryState.restoreLocalState();
    const recovered = await retryState.placeOrder(bag, 1, "Midtrans");

    expect(recovered.id).toBe("ambiguous-order");
    expect(backend.keys).toHaveLength(2);
    expect(backend.keys[1]).toBe(backend.keys[0]);

    backend.resolveCommittedOrder();
    await retryState.loadOrders();

    const nextCheckoutState = track(new AppState());
    nextCheckoutState.restoreLocalState();
    await nextCheckoutState.placeOrder(bag, 1, "Midtrans");

    expect(backend.keys).toHaveLength(3);
    expect(backend.keys[2]).not.toBe(backend.keys[1]);
  });

  it("payout fail-closed ketika operator belum mengaktifkannya", async () => {
    await appState.loadBalance();

    const error = await backendError(appState.withdraw(50000));
    expect(error.code).toBe("payout_disabled");
    expect(error.message).toBe("Fitur penarikan dana belum diaktifkan oleh operator.");
  });
});

describe("local preferences", () => {
  it("restoreLocalState drops invalid points and unsupported payment methods", () => {
    localStorage.setItem("savebite.onboarding_seen", "true");
    localStorage.setItem("savebite.location_label", "Sekitar saya");
    localStorage.setItem("savebite.location_latitude", "0");
    localStorage.setItem("savebite.location_longitude", "0");
    localStorage.setItem("savebite.default_payment_method", "OVO");
    localStorage.setItem("savebite.pending_merchant_intent", "merchant");
    const state = track(new AppState());
    state.restoreLocalState();
    expect(state.onboardingSeen).toBe(true);
    expect(state.location).toBe("Sekitar saya");
    expect(state.userLatitude).toBeNull();
    expect(state.userLongitude).toBeNull();
    expect(state.userLocationIsFromDevice).toBe(false);
    expect(state.defaultPaymentMethod).toBe("QRIS");
    expect(state.pendingMerchantIntent).toBe(true);
  });

  it("an old device point without the device keys is recovered from the search point", () => {
    localStorage.setItem("savebite.location_label", "Sekitar saya");
    localStorage.setItem("savebite.location_latitude", "-6.2");
    localStorage.setItem("savebite.location_longitude", "106.8");
    localStorage.setItem("savebite.location_accuracy_meters", "15");
    const state = track(new AppState());
    state.restoreLocalState();
    expect(state.userLocationIsFromDevice).toBe(true);
    expect([state.deviceLatitude, state.deviceLongitude]).toEqual([-6.2, 106.8]);
    expect(state.userLocationAccuracyMeters).toBe(15);
  });

  it("onboarding, priming, and the merchant intent persist", async () => {
    const state = track(new AppState());
    await state.markOnboardingSeen();
    await state.markLocationPrimed();
    await state.setPendingMerchantIntent(false);
    const restored = track(new AppState());
    restored.restoreLocalState();
    expect([restored.onboardingSeen, restored.locationPrimed, restored.pendingMerchantIntent]).toEqual([true, true, false]);

    expect(restored.consumePendingMerchantIntent()).toBe(false);
    expect(restored.pendingMerchantIntent).toBeNull();
    const again = track(new AppState());
    again.restoreLocalState();
    expect(again.pendingMerchantIntent).toBeNull();
  });

  it("a corrupt idempotency map is ignored", async () => {
    localStorage.setItem("savebite.pending_checkout_idempotency_v1", "{not json");
    const backend = useBackend(new CheckoutProbeBackend());
    const state = track(new AppState());
    state.restoreLocalState();
    await state.placeOrder(await firstNearbyBag(backend), 1, "QRIS");
    expect(backend.keys).toHaveLength(1);
  });
});

describe("location", () => {
  it("setLocation uses the known city points and reloads", async () => {
    appState.setLocation("Kemang, Jakarta");
    expect(appState.location).toBe("Kemang, Jakarta");
    expect([appState.userLatitude, appState.userLongitude]).toEqual([-6.2607, 106.8134]);
    await flush();
    expect(appState.isLoadingConsumer).toBe(false);
    expect(appState.nearbyBags.length).toBeGreaterThan(0);

    appState.setLocation("Kota lain");
    expect(appState.location).toBe("Kota lain");
    expect([appState.userLatitude, appState.userLongitude]).toEqual([-6.2607, 106.8134]);
  });

  it("invalid coordinates are refused", async () => {
    await expect(appState.setLocationWithCoordinates("X", Number.NaN, 106)).rejects.toThrow("Koordinat lokasi tidak valid.");
    await expect(appState.setLocationWithCoordinates("X", 0, 0)).rejects.toThrow();
    expect(appState.location).toBe("Margonda, Depok");
  });

  it("the demo store location is a fixed point", async () => {
    expect(await appState.determineStoreLocation()).toEqual({ latitude: -6.372, longitude: 106.8318, accuracy: 5 });
    expect(appState.isDeterminingLocation).toBe(false);
    expect(appState.hasLocationPermission).toBe(true);
  });

  it("the filter narrows the cached area without a new request", async () => {
    await appState.loadConsumerHome();
    const all = appState.allNearbyBags.length;
    await appState.setBagFilter({ ...EMPTY_FILTER, categories: new Set(["Resto"]) });
    expect(appState.nearbyBags.map((bag) => bag.merchant.category)).toEqual(["Resto", "Resto"]);
    expect(appState.allNearbyBags).toHaveLength(all);
    expect(appState.hasNearbyBags).toBe(true);
    expect((await appState.search("pizza")).map((bag) => bag.id)).toEqual(["b7"]);
    expect(await appState.search("kopi")).toEqual([]);
  });
});

describe("consumer actions", () => {
  it("toggleFavorite updates the ids at once and reloads the favourites", async () => {
    expect(await appState.toggleFavorite("m4")).toBe(true);
    expect(appState.isFavorite("m4")).toBe(true);
    await flush();
    expect(appState.favoriteStores.map((store) => store.merchant.id)).toContain("m4");
    expect(await appState.toggleFavorite("m4")).toBe(false);
    expect(appState.isFavorite("m4")).toBe(false);
  });

  it("local checkout validates the quantity against the cached stock", async () => {
    await appState.loadConsumerHome();
    const bag = appState.findBag("b1");
    if (!bag) throw new Error("b1 missing");
    for (const quantity of [0, bag.quantityLeft + 1]) {
      const error = await backendError(appState.placeOrder(bag, quantity, "QRIS"));
      expect([error.code, error.message]).toEqual(["invalid_quantity", "Jumlah bag tidak sesuai stok yang tersedia."]);
    }
  });

  it("the voucher flow: ready order → pickup token → redeem → history", async () => {
    await appState.updateStore({ name: "Roti Nyaman Bakery" });
    await Promise.all([appState.loadOrders(), appState.loadMerchantData()]);
    const order = appState.findOrder("order-1");
    if (!order) throw new Error("order-1 missing");

    const issued = await appState.issuePickupToken(order);
    expect(appState.findOrder("order-1")?.pickupToken).toBe(issued.pickupToken);

    const redeemed = await appState.redeemOrder(issued.pickupToken ?? "");
    expect(redeemed?.status).toBe("redeemed");
    expect(appState.findIncomingOrder("order-1")?.status).toBe("redeemed");
    await flush();
    expect(appState.findOrder("order-1")).toMatchObject({ status: "done", canRate: true });
    expect(appState.balance).toBe(1245000 + 13500);
    expect(appState.redeemedBagCount).toBe(1);

    await appState.submitReview(appState.findOrder("order-1") ?? order, 5, [], "");
    expect(appState.findOrder("order-1")).toMatchObject({ reviewed: true, canRate: false });
  });

  it("an unknown pickup code is not an error", async () => {
    expect(await appState.redeemOrder("savebite-pickup:unknown")).toBeNull();
  });

  it("markAllNotificationsRead clears the badge", async () => {
    await appState.loadNotifications();
    expect(appState.unreadCount).toBe(1);
    await appState.markAllNotificationsRead();
    expect(appState.unreadCount).toBe(0);
  });
});

describe("merchant actions", () => {
  it("marking ready and cancelling update both the merchant and the consumer lists", async () => {
    await appState.updateStore({});
    await Promise.all([appState.loadOrders(), appState.loadMerchantData()]);
    await appState.markOrderReady("order-5");
    expect(appState.findIncomingOrder("order-5")).toMatchObject({ status: "ready", needsAction: false });

    const cancelled = await appState.cancelMerchantOrder("order-1");
    expect(cancelled.status).toBe("cancelled");
    expect(appState.findIncomingOrder("order-1")?.status).toBe("cancelled");
    expect(appState.completedOrders.map((order) => order.id)).toContain("order-1");
    expect(appState.activeOrders.some((order) => order.id === "order-1")).toBe(false);
    expect(appState.orderHistory[0]).toMatchObject({ id: "order-1", status: "cancelled", canRate: false, pickupToken: null });
  });

  it("bags: add, toggle, and duplicate reload the merchant data", async () => {
    await appState.loadMerchantData();
    const before = appState.allMerchantBags.length;
    await appState.addBag({
      title: "Bag Baru",
      salePrice: 15000,
      pickupWindow: "19.00–20.00",
      total: 2,
      description: "",
      contents: [],
      originalPrice: 30000,
    });
    await flush();
    expect(appState.allMerchantBags).toHaveLength(before + 1);
    const created = appState.allMerchantBags[0];

    await appState.toggleBagActive(created);
    expect(appState.findMerchantBag(created.id)?.active).toBe(false);
    await flush();
    expect(appState.inactiveBags.map((bag) => bag.id)).toContain(created.id);

    await appState.duplicateBag(created);
    await flush();
    expect(appState.allMerchantBags).toHaveLength(before + 2);
  });

  it("bank accounts: saving selects the new account; choosing one makes it the default", async () => {
    await appState.loadBalance();
    expect(appState.selectedBank).toBe("BCA · •••• 6789");
    const account = await appState.saveBankAccount({
      bankCode: "BNI",
      bankName: "BNI",
      accountNumber: "1234567890",
      accountHolder: "Ilham",
    });
    expect(appState.selectedBank).toBe("BNI · •••• 7890");
    expect(appState.selectedBankAccount?.id).toBe(account.id);
    await flush();

    const bca = appState.bankAccountRecords.find((item) => item.id === "bank-1");
    if (!bca) throw new Error("bank-1 missing");
    await appState.setBankAccount(bca);
    expect(appState.selectedBank).toBe("BCA · •••• 6789");
    expect(appState.bankAccountRecords.filter((item) => item.isDefault).map((item) => item.id)).toEqual(["bank-1"]);
    expect(appState.bankAccounts).toContain("BNI · •••• 7890");
  });

  it("withdraw needs a bank account and reuses its key after a lost response", async () => {
    appState.businessConfig = { ...DEFAULT_BUSINESS_CONFIG, payoutsEnabled: true };
    const empty = track(new AppState());
    empty.businessConfig = appState.businessConfig;
    const missing = await backendError(empty.withdraw(50000));
    expect([missing.code, missing.message]).toEqual(["bank_required", "Tambahkan rekening bank sebelum menarik saldo."]);

    class LostPayoutBackend extends FakeBackend {
      readonly keys: string[] = [];
      override async requestPayout(input: { amount: number; bankAccountId: string; idempotencyKey: string }) {
        this.keys.push(input.idempotencyKey);
        const request = await super.requestPayout(input);
        if (this.keys.length === 1) throw new BackendException("network_lost", "Respons hilang.");
        return request;
      }
    }
    const backend = useBackend(new LostPayoutBackend());
    await appState.loadBalance();
    await backendError(appState.withdraw(100000));
    const request = await appState.withdraw(100000);
    expect(backend.keys).toHaveLength(2);
    expect(backend.keys[1]).toBe(backend.keys[0]);
    expect(await backend.payoutRequests()).toHaveLength(1);
    expect(appState.payoutRequests[0]).toBe(request);
    expect(appState.findPayoutRequest(request.id)).toBe(request);

    await appState.withdraw(100000);
    expect(backend.keys).toHaveLength(3);
    expect(backend.keys[2]).not.toBe(backend.keys[1]);
  });

  it("updateStore keeps unspecified fields and starts realtime for the merchant", async () => {
    await appState.updateStore({ name: "  Toko Baru  ", description: "Desc", logoUrl: "blob:logo" });
    expect(appState.merchantSetupDone).toBe(true);
    expect(appState.storeName).toBe("Toko Baru");
    expect(appState.storeAddress).toBe("Jl. Margonda Raya No. 88, Depok");
    expect(appState.storeLogoUrl).toBe("blob:logo");
    await flush();
    expect(appState.incomingOrders).toHaveLength(2);
    expect(appState.transactions).toHaveLength(3);
    expect(appState.balance).toBe(1245000);
  });
});

describe("profile, session, and errors", () => {
  it("bootstrap applies the demo profile and store", async () => {
    const state = track(new AppState());
    await state.bootstrap();
    expect(state.userName).toBe("Ilham Hidayat");
    expect(state.userInitials).toBe("IH");
    expect(state.merchantSetupDone).toBe(false);
    expect(state.businessConfig).toEqual(DEFAULT_BUSINESS_CONFIG);
    expect(state.isBootstrapping).toBe(false);
    expect(state.usesRemoteBackend).toBe(false);
  });

  it("updateProfile keeps the name when it is blank", async () => {
    await appState.updateProfile({ name: "   ", phone: " 0811 " });
    expect(appState.userName).toBe("Ilham Hidayat");
    expect(appState.userPhone).toBe("0811");
    await appState.updateProfile({ name: " Nadia Putri " });
    expect(appState.userName).toBe("Nadia Putri");
    expect(appState.userInitials).toBe("NP");
  });

  it("rememberMode and the mode switch", async () => {
    appState.rememberMode("merchant");
    expect(appState.lastMode).toBe("merchant");
    await flush();
    const state = track(new AppState());
    await state.bootstrap();
    expect(state.lastMode).toBe("merchant");
    appState.switchToMerchant();
    expect(appState.mode).toBe("merchant");
    appState.switchToConsumer();
    expect(appState.mode).toBe("consumer");
  });

  it("deleteAccount wipes the demo data and the session", async () => {
    await appState.loadOrders();
    await appState.deleteAccount();
    expect(appState.activeOrders).toEqual([]);
    expect(appState.userName).toBe("Pengguna");
    await appState.loadOrders();
    expect(appState.activeOrders).toEqual([]);
  });

  it("messageFor shows domain messages and hides everything else", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(appState.messageFor(new BackendException("x", "Pesan domain."))).toBe("Pesan domain.");
    expect(appState.messageFor(new LocationError("timeout", "Timeout expired"))).toBe("Terjadi kendala. Silakan coba lagi.");
    expect(appState.messageFor(new Error("SQL detail"), "Fallback.")).toBe("Fallback.");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reportError and clearError drive the global error banner", () => {
    appState.reportError(new BackendException("x", "Ada masalah."));
    expect(appState.errorMessage).toBe("Ada masalah.");
    appState.clearError();
    expect(appState.errorMessage).toBeNull();
  });

  it("listeners are notified and can unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = appState.subscribe(listener);
    const version = appState.getVersion();
    appState.switchToMerchant();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(appState.getVersion()).toBe(version + 1);
    unsubscribe();
    appState.switchToConsumer();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("newUuid is a v4 uuid", () => {
    expect(newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newUuid()).not.toBe(newUuid());
  });
});
