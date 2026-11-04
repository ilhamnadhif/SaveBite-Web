/**
 * Port of `test/fake_backend_test.dart` and
 * `test/fake_backend_realtime_cancel_test.dart`, plus the web-only parts of
 * the demo backend (deep-link lookups, local image "uploads").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeBackend } from "../lib/backend/fake";
import { BackendException, DEFAULT_BUSINESS_CONFIG } from "../lib/backend/types";
import { pickImageFile } from "../lib/imagePicker";
import { EMPTY_FILTER, orderRecord, type AppNotification, type Bag, type OrderRecord } from "../lib/models";
import { SampleData } from "../lib/sampleData";
import { backendError, flush } from "./support/harness";

vi.mock("../lib/imagePicker", () => ({ pickImageFile: vi.fn(), compressImage: vi.fn() }));

const HOUR_MS = 3_600_000;

async function nearbyBag(backend: FakeBackend, id: string): Promise<Bag> {
  const bag = (await backend.nearbyBags()).find((item) => item.id === id);
  if (!bag) throw new Error(`bag ${id} is not available`);
  return bag;
}

async function activeOrder(backend: FakeBackend, id: string): Promise<OrderRecord> {
  const order = (await backend.activeOrders()).find((item) => item.id === id);
  if (!order) throw new Error(`order ${id} is not active`);
  return order;
}

function storeInput(fields: { latitude?: number; longitude?: number; name?: string } = {}) {
  return {
    name: fields.name ?? "Toko Demo SaveBite",
    category: "Bakery",
    address: "Jl. Demo No. 1, Depok",
    open: "08.00",
    close: "21.00",
    latitude: fields.latitude,
    longitude: fields.longitude,
  };
}

function bagInput(fields: Partial<Parameters<FakeBackend["addBag"]>[0]> = {}) {
  return {
    title: "Bag Isi Uji",
    salePrice: 15000,
    pickupWindow: "19.00–20.00",
    total: 3,
    description: "Deskripsi isi untuk pengujian.",
    contents: ["Roti", "Pastry"],
    originalPrice: 45000,
    ...fields,
  };
}

describe("FakeBackend checkout", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = new FakeBackend();
  });

  it("idempotency tidak menduplikasi order atau mengurangi stok dua kali", async () => {
    const before = await backend.activeOrders();

    const first = await backend.placeOrder(SampleData.bagRoti, 2, "GoPay", "checkout-same-request");
    const retry = await backend.placeOrder(SampleData.bagRoti, 2, "GoPay", "checkout-same-request");

    expect(retry.id).toBe(first.id);
    const orders = await backend.activeOrders();
    expect(orders).toHaveLength(before.length + 1);
    expect(orders.filter((order) => order.id === first.id)).toHaveLength(1);

    expect((await nearbyBag(backend, SampleData.bagRoti.id)).quantityLeft).toBe(1);
  });

  it("idempotency key yang dipakai dengan parameter berbeda ditolak", async () => {
    const before = await backend.activeOrders();
    const placed = await backend.placeOrder(SampleData.bagRoti, 1, "GoPay", "checkout-conflict");

    expect((await backendError(backend.placeOrder(SampleData.bagRoti, 2, "GoPay", "checkout-conflict"))).code).toBe(
      "idempotency_conflict",
    );
    expect(await backend.activeOrders()).toHaveLength(before.length + 1);
    expect((await nearbyBag(backend, SampleData.bagRoti.id)).quantityLeft).toBe(SampleData.bagRoti.quantityLeft - 1);

    await backend.markOrderReady(placed.id);
    const retry = await backend.placeOrder(SampleData.bagRoti, 1, "GoPay", "checkout-conflict");
    expect(retry.id).toBe(placed.id);
    expect(retry.status).toBe("ready");
    expect(retry.pickupToken).toBeNull();
  });

  it("jumlah nol, negatif, melebihi stok, dan sold out ditolak", async () => {
    for (const quantity of [0, -1, SampleData.bagRoti.quantityLeft + 1]) {
      const error = await backendError(backend.placeOrder(SampleData.bagRoti, quantity, "GoPay", `invalid-${quantity}`));
      expect(error.code).toBe(quantity <= 0 ? "invalid_quantity" : "insufficient_stock");
    }

    expect((await backendError(backend.placeOrder(SampleData.bagDonat, 1, "GoPay", "sold-out"))).code).toBe(
      "insufficient_stock",
    );
  });

  it("subtotal, biaya layanan, dan total memakai satu sumber hitung", async () => {
    const order = await backend.placeOrder(SampleData.bagKopi, 2, "OVO", "fee-calculation");

    expect(order.quantity).toBe(2);
    expect(order.subtotalAmount).toBe(SampleData.bagKopi.salePrice * 2);
    expect(order.serviceFee).toBe(1000);
    expect(order.amount).toBe(order.subtotalAmount + order.serviceFee);
    expect(order.paymentMethod).toBe("OVO");
  });

  it("validates the payment method, the key, and the 100-bag cap with Indonesian messages", async () => {
    const methodError = await backendError(backend.placeOrder(SampleData.bagKopi, 1, "   ", "valid-key-1"));
    expect([methodError.code, methodError.message]).toEqual(["invalid_payment_method", "Metode pembayaran tidak valid."]);
    expect((await backendError(backend.placeOrder(SampleData.bagKopi, 1, "x".repeat(65), "valid-key-2"))).code).toBe(
      "invalid_payment_method",
    );
    const keyError = await backendError(backend.placeOrder(SampleData.bagKopi, 1, "QRIS", "short"));
    expect([keyError.code, keyError.message]).toEqual([
      "invalid_idempotency_key",
      "Identitas permintaan checkout tidak valid.",
    ]);
    expect((await backendError(backend.placeOrder(SampleData.bagKopi, 1, "QRIS", "k".repeat(129)))).code).toBe(
      "invalid_idempotency_key",
    );
    const capError = await backendError(backend.placeOrder(SampleData.bagKopi, 101, "QRIS", "valid-key-3"));
    expect([capError.code, capError.message]).toEqual(["invalid_quantity", "Jumlah bag harus antara 1 dan 100."]);
    const stockError = await backendError(backend.placeOrder(SampleData.bagKopi, 7, "QRIS", "valid-key-4"));
    expect(stockError.message).toBe("Stok bag sudah berubah. Silakan pilih jumlah yang tersedia.");
  });

  it("a placed order is pending, paid, trimmed, and appears for the merchant", async () => {
    const order = await backend.placeOrder(SampleData.bagKopi, 2, " QRIS ", "incoming-order");
    expect(order).toMatchObject({
      status: "pending",
      paymentState: "paid",
      paymentMethod: "QRIS",
      dateLabel: "Hari ini",
      merchantNetAmount: 36000,
      pickupToken: null,
    });
    expect(order.code).toMatch(/^SB-[0-9A-Z]{5}$/);
    expect(order.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 3 * HOUR_MS);

    const [incoming] = await backend.incomingOrders();
    expect(incoming).toMatchObject({
      id: order.id,
      customer: "Ilham Hidayat",
      initial: "I",
      time: "Baru saja",
      bags: 2,
      code: order.code,
      status: "paid",
      needsAction: true,
      bagTitle: SampleData.bagKopi.title,
      unitPrice: 20000,
      subtotalAmount: 40000,
      serviceFee: 1000,
      merchantNetAmount: 36000,
    });
  });

  it("order codes and ids are deterministic per backend", async () => {
    const first = await backend.placeOrder(SampleData.bagKopi, 1, "QRIS", "deterministic-1");
    const second = await backend.placeOrder(SampleData.bagSalad, 1, "QRIS", "deterministic-2");
    expect([first.id, first.code]).toEqual(["order-100", "SB-000RS"]);
    expect([second.id, second.code]).toEqual(["order-101", "SB-000RT"]);
  });

  it("refreshPayment returns the stored order or order_not_found", async () => {
    const placed = await backend.placeOrder(SampleData.bagKopi, 1, "QRIS", "refresh-payment");
    expect((await backend.refreshPayment(placed)).id).toBe(placed.id);
    expect((await backend.refreshPayment((await backend.orderHistory())[0])).id).toBe("order-2");
    const missing = orderRecord({ id: "nope", bag: SampleData.bagKopi, code: "SB-X", dateLabel: "", amount: 0, status: "pending" });
    expect((await backendError(backend.refreshPayment(missing))).code).toBe("order_not_found");
  });
});

describe("pickup token", () => {
  it("referensi publik tidak dapat redeem; token hanya berlaku sekali", async () => {
    const backend = new FakeBackend();
    const placed = await backend.placeOrder(SampleData.bagKopi, 1, "GoPay", "pickup-order");
    expect(placed.pickupToken).toBeNull();
    expect((await backendError(backend.issuePickupToken(placed))).code).toBe("order_not_redeemable");
    await backend.markOrderReady(placed.id);
    const ready = await activeOrder(backend, placed.id);
    const issued = await backend.issuePickupToken(ready);

    expect(await backend.redeemOrder(issued.code)).toBeNull();
    expect(issued.pickupToken).not.toBeNull();
    const token = issued.pickupToken ?? "";

    const redeemed = await backend.redeemOrder(token);
    expect(redeemed).not.toBeNull();
    expect(redeemed?.status).toBe("redeemed");
    expect(await backend.redeemOrder(token)).toBeNull();
    expect((await backend.activeOrders()).filter((order) => order.id === placed.id)).toHaveLength(0);
    expect((await backend.orderHistory()).find((order) => order.id === placed.id)?.status).toBe("done");
  });

  it("a new token replaces the previous one; an empty code is invalid", async () => {
    const backend = new FakeBackend();
    const sample = await activeOrder(backend, "order-1");
    const first = await backend.issuePickupToken(sample);
    const second = await backend.issuePickupToken(sample);
    expect(first.pickupToken).not.toBe(second.pickupToken);
    expect(first.pickupToken).toMatch(/^savebite-pickup:token-\d+:\d+$/);
    expect(await backend.redeemOrder(first.pickupToken ?? "")).toBeNull();
    expect((await backendError(backend.redeemOrder("   "))).code).toBe("invalid_pickup_code");
    expect((await backend.redeemOrder(` ${second.pickupToken ?? ""} `))?.id).toBe("order-1");
  });

  it("expired tokens and orders are rejected with their own codes", async () => {
    vi.useFakeTimers({ now: new Date(2026, 6, 19, 19, 0), toFake: ["Date"] });
    try {
      const backend = new FakeBackend();
      const order = await activeOrder(backend, "order-1");
      const issued = await backend.issuePickupToken(order);
      vi.setSystemTime(new Date(2026, 6, 19, 19, 2));
      const error = await backendError(backend.redeemOrder(issued.pickupToken ?? ""));
      expect([error.code, error.message]).toEqual([
        "pickup_token_expired",
        "QR sudah diperbarui. Minta pembeli menampilkan QR terbaru.",
      ]);
      // The expired token is forgotten.
      expect(await backend.redeemOrder(issued.pickupToken ?? "")).toBeNull();

      const placed = await backend.placeOrder(
        { ...SampleData.bagKopi, pickupEndsAt: new Date(2026, 6, 19, 19, 30) },
        1,
        "QRIS",
        "expiring-order",
      );
      await backend.markOrderReady(placed.id);
      vi.setSystemTime(new Date(2026, 6, 19, 19, 31));
      const expired = await backendError(backend.issuePickupToken(await activeOrder(backend, placed.id)));
      expect([expired.code, expired.message]).toEqual(["order_expired", "Masa pickup pesanan sudah berakhir."]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the token never outlives the pickup window and pickup cannot start early", async () => {
    vi.useFakeTimers({ now: new Date(2026, 6, 19, 19, 0), toFake: ["Date"] });
    try {
      const backend = new FakeBackend();
      const early = await backend.placeOrder(
        { ...SampleData.bagKopi, pickupStartsAt: new Date(2026, 6, 19, 20, 0), pickupEndsAt: new Date(2026, 6, 19, 21, 0) },
        1,
        "QRIS",
        "early-pickup",
      );
      await backend.markOrderReady(early.id);
      const token = (await backend.issuePickupToken(await activeOrder(backend, early.id))).pickupToken ?? "";
      const error = await backendError(backend.redeemOrder(token));
      expect([error.code, error.message]).toEqual(["pickup_not_started", "Waktu pickup pesanan belum dimulai."]);

      const closing = await backend.placeOrder(
        { ...SampleData.bagSalad, pickupEndsAt: new Date(2026, 6, 19, 19, 0, 30) },
        1,
        "QRIS",
        "closing-soon",
      );
      await backend.markOrderReady(closing.id);
      const closingToken = (await backend.issuePickupToken(await activeOrder(backend, closing.id))).pickupToken ?? "";
      vi.setSystemTime(new Date(2026, 6, 19, 19, 0, 45));
      // The token deadline is the order expiry (30 s), not the usual 90 s.
      expect((await backendError(backend.redeemOrder(closingToken))).code).toBe("pickup_token_expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("redeeming pays the merchant and records the income", async () => {
    const backend = new FakeBackend();
    const balance = await backend.balance();
    const stats = await backend.merchantStats();
    const order = await activeOrder(backend, "order-1");
    const token = (await backend.issuePickupToken(order)).pickupToken ?? "";

    const redeemed = await backend.redeemOrder(token);
    expect(redeemed).toMatchObject({ id: "order-1", redeemed: true, status: "redeemed", needsAction: false });
    expect(redeemed?.redeemedAt).toBeInstanceOf(Date);
    expect(await backend.balance()).toBe(balance + 13500);
    const [tx] = await backend.transactions();
    expect(tx).toMatchObject({
      title: "Order SB-7K2Q9",
      subtitle: "Hari ini · selesai",
      amount: 13500,
      kind: "income",
      status: "completed",
    });
    const after = await backend.merchantStats();
    expect(after.bagsSoldToday).toBe(stats.bagsSoldToday + 1);
    expect(after.incomeToday).toBe(stats.incomeToday + 13500);
    expect(after.pendingOrderCount).toBe(stats.pendingOrderCount - 1);
    expect((await backend.orderHistory())[0]).toMatchObject({ id: "order-1", status: "done", canRate: true, pickupToken: null });
  });

  it("only paid or preparing orders can be marked ready", async () => {
    const backend = new FakeBackend();
    const error = await backendError(backend.markOrderReady("order-1"));
    expect([error.code, error.message]).toEqual(["invalid_order_status", "Pesanan ini tidak dapat ditandai siap."]);
    expect((await backendError(backend.markOrderReady("missing"))).code).toBe("order_not_found");

    await backend.markOrderReady("order-5");
    expect((await backend.incomingOrders()).find((order) => order.id === "order-5")).toMatchObject({
      status: "ready",
      needsAction: false,
    });
    expect((await backend.notifications())[0]).toMatchObject({
      title: "Pesanan siap diambil",
      body: "Surprise Bag Roti & Pastry sudah siap.",
      type: "ready",
      unread: true,
      route: "orders",
      time: "Baru saja",
      group: "Hari ini",
    });
  });

  it("clearing the session cache invalidates every pickup token", async () => {
    const backend = new FakeBackend();
    const token = (await backend.issuePickupToken(await activeOrder(backend, "order-1"))).pickupToken ?? "";
    backend.clearSessionCache();
    expect((await activeOrder(backend, "order-1")).pickupToken).toBeNull();
    expect(await backend.redeemOrder(token)).toBeNull();
  });
});

describe("favorite atomic", () => {
  it("toggle beruntun konsisten dan merchant asing ditolak", async () => {
    const backend = new FakeBackend();

    const results = await Promise.all([backend.toggleFavorite("m3"), backend.toggleFavorite("m3")]);
    expect(results).toEqual([true, false]);
    expect(await backend.favoriteMerchantIds()).not.toContain("m3");

    expect(await backend.toggleFavorite("m4")).toBe(true);
    expect((await backend.favoriteStores()).map((store) => store.merchant.id)).toContain("m4");

    expect((await backendError(backend.toggleFavorite("merchant-tidak-ada"))).code).toBe("merchant_not_found");
  });

  it("favorite stores report today's stock", async () => {
    const backend = new FakeBackend();
    await backend.toggleFavorite("m3");
    const stores = await backend.favoriteStores();
    expect(stores.map((store) => [store.merchant.id, store.availability, store.soldOut])).toEqual([
      ["m1", "3 bag tersedia", false],
      ["m2", "6 bag tersedia", false],
      ["m8", "7 bag tersedia", false],
      ["m3", "Habis hari ini", true],
    ]);
  });

  it("the demo merchant may favourite its own store once it exists", async () => {
    const backend = new FakeBackend();
    expect((await backendError(backend.toggleFavorite("store-me"))).code).toBe("merchant_not_found");
    await backend.upsertStore(storeInput());
    await backend.setMerchantVerification("store-me", "verified");
    expect(await backend.toggleFavorite("store-me")).toBe(true);
    expect((await backend.favoriteStores()).find((store) => store.merchant.id === "store-me")).toMatchObject({
      availability: "Habis hari ini",
      soldOut: true,
    });
  });
});

describe("discovery bag merchant demo", () => {
  it("bag yang baru dibuat tampil di browse dan detail toko", async () => {
    const backend = new FakeBackend();
    const latitude = -6.3718;
    const longitude = 106.8318;
    await backend.upsertStore(storeInput({ latitude, longitude }));
    await backend.setMerchantVerification("store-me", "verified");
    const now = new Date();
    await backend.addBag(
      bagInput({
        title: "Bag Baru Hari Ini",
        pickupWindow: "18.00–20.00",
        description: "Bag lokal untuk uji discovery.",
        availableOn: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        pickupStartsAt: now,
        pickupEndsAt: new Date(now.getTime() + 2 * HOUR_MS),
      }),
    );
    const [created] = await backend.myBags();

    const nearby = await backend.nearbyBags({ latitude, longitude });
    const published = nearby.find((bag) => bag.id === created.id);
    expect(published?.merchant.id).toBe("store-me");
    expect(published?.merchant.name).toBe("Toko Demo SaveBite");
    expect(published?.merchant.distance).toBe("0.0 km");
    expect((await backend.bagsByMerchant("store-me")).some((bag) => bag.id === created.id)).toBe(true);

    if (!published) throw new Error("published bag missing");
    expect((await backendError(backend.placeOrder(published, 1, "GoPay", "self-purchase-demo"))).code).toBe(
      "self_purchase_forbidden",
    );

    await backend.setBagActive(created, false);
    expect((await backend.nearbyBags()).filter((bag) => bag.id === created.id)).toHaveLength(0);
  });

  it("the local store bag carries the demo merchant identity", async () => {
    const backend = new FakeBackend();
    await backend.upsertStore({ ...storeInput({ name: "  toko pagi " }), description: "Desc" });
    await backend.setMerchantVerification("store-me", "verified");
    await backend.addBag(bagInput({ originalPrice: 15000 }));
    const [bag] = await backend.bagsByMerchant("store-me");
    expect(bag.merchant).toMatchObject({
      name: "toko pagi",
      initial: "T",
      avatarColor: SampleData.rotiNyaman.avatarColor,
      distance: "Lokasi toko",
      hours: "08.00–21.00",
      coverImage: SampleData.img1,
      rating: 0,
      reviewCount: 0,
      bagsSaved: 0,
    });
    expect(bag).toMatchObject({ originalPrice: 15000, quantityTotal: 3, soldOut: false });
  });

  it("future dates and finished pickup windows are hidden from browse", async () => {
    const backend = new FakeBackend();
    await backend.upsertStore(storeInput());
    await backend.setMerchantVerification("store-me", "verified");
    const now = new Date();
    await backend.addBag(bagInput({ title: "Besok", availableOn: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) }));
    await backend.addBag(bagInput({ title: "Sudah lewat", pickupEndsAt: new Date(now.getTime() - 1000) }));
    await backend.addBag(bagInput({ title: "Hari ini" }));
    const titles = (await backend.bagsByMerchant("store-me")).map((bag) => bag.title);
    expect(titles).toEqual(["Hari ini"]);
  });

  it("nearby bags: available only, sample order without a location, nearest first with one", async () => {
    const backend = new FakeBackend();
    const plain = await backend.nearbyBags();
    expect(plain.map((bag) => bag.id)).toEqual(["b1", "b2", "b8", "b4", "b5", "b6", "b7"]);
    expect(plain[0].merchant.distance).toBe("0,4 km");

    const sorted = await backend.nearbyBags({ latitude: -6.3725, longitude: 106.8323 });
    const km = sorted.map((bag) => Number.parseFloat(bag.merchant.distance));
    expect([...km].sort((a, b) => a - b)).toEqual(km);
    expect(sorted.every((bag) => /^\d+\.\d km$/.test(bag.merchant.distance))).toBe(true);
    expect(sorted[0].id).toBe("b1");
  });

  it("FakeBackend menerapkan kategori, harga, dan jarak bersama-sama", async () => {
    const backend = new FakeBackend();
    const results = await backend.nearbyBags({
      latitude: -6.3725,
      longitude: 106.8323,
      filter: { ...EMPTY_FILTER, categories: new Set(["Kafe"]), maxDistanceKm: 1, minPrice: 15000, maxPrice: 21000 },
    });

    expect(results).toHaveLength(1);
    expect(results[0].merchant.category).toBe("Kafe");
    expect(results[0].salePrice).toBeGreaterThanOrEqual(15000);
    expect(results[0].salePrice).toBeLessThanOrEqual(21000);
  });

  it("search matches the title, the store name, or the category", async () => {
    const backend = new FakeBackend();
    const ids = async (query: string) => (await backend.searchBags(query)).map((bag) => bag.id);
    expect(await ids("pizza")).toEqual(["b7"]);
    expect(await ids("KOPI senja")).toEqual(["b2"]);
    expect(await ids("sehat")).toEqual(["b8", "b4"]);
    expect(await ids("tidak ada")).toEqual([]);
    expect(await ids("")).toHaveLength(7);
  });

  it("sold-out stock disappears from browse and deep links", async () => {
    const backend = new FakeBackend();
    await backend.placeOrder(SampleData.bagPizza, 2, "QRIS", "buy-all-pizza");
    expect((await backend.nearbyBags()).some((bag) => bag.id === "b7")).toBe(false);
    expect(await backend.bagById("b7")).toBeNull();
  });
});

describe("deep links (web only)", () => {
  it("bagById returns the live available bag or null", async () => {
    const backend = new FakeBackend();
    await backend.placeOrder(SampleData.bagRoti, 1, "QRIS", "deep-link-stock");
    expect(await backend.bagById("b1")).toMatchObject({ id: "b1", quantityLeft: 2, soldOut: false });
    expect(await backend.bagById("b3")).toBeNull();
    expect(await backend.bagById("missing")).toBeNull();
  });

  it("merchantById finds sample stores and the demo store", async () => {
    const backend = new FakeBackend();
    expect(await backend.merchantById("m2")).toBe(SampleData.kopiSenja);
    expect(await backend.merchantById("store-me")).toBeNull();
    await backend.upsertStore(storeInput());
    await backend.setMerchantVerification("store-me", "verified");
    expect(await backend.merchantById("store-me")).toMatchObject({ id: "store-me", name: "Toko Demo SaveBite" });
    expect(await backend.merchantById("missing")).toBeNull();
  });
});

describe("pembatalan merchant", () => {
  it("mengembalikan stok tepat sekali dan memindahkan order konsumen", async () => {
    const backend = new FakeBackend();
    const placed = await backend.placeOrder(SampleData.bagRoti, 2, "GoPay", "cancel-order-once");
    await backend.markOrderReady(placed.id);

    expect((await nearbyBag(backend, SampleData.bagRoti.id)).quantityLeft).toBe(1);

    const cancelled = await backend.cancelMerchantOrder(placed.id);
    expect(cancelled.status).toBe("cancelled");
    expect((await backend.orderHistory()).find((order) => order.id === placed.id)?.status).toBe("cancelled");
    expect((await backend.activeOrders()).filter((order) => order.id === placed.id)).toHaveLength(0);
    expect((await nearbyBag(backend, SampleData.bagRoti.id)).quantityLeft).toBe(SampleData.bagRoti.quantityLeft);

    const retry = await backend.cancelMerchantOrder(placed.id);
    expect(retry.status).toBe("cancelled");
    expect((await nearbyBag(backend, SampleData.bagRoti.id)).quantityLeft).toBe(SampleData.bagRoti.quantityLeft);
  });

  it("order redeemed tidak dapat dibatalkan", async () => {
    const backend = new FakeBackend();
    const placed = await backend.placeOrder(SampleData.bagKopi, 1, "GoPay", "cancel-after-redeem");
    await backend.markOrderReady(placed.id);
    const tokenized = await backend.issuePickupToken(await activeOrder(backend, placed.id));
    await backend.redeemOrder(tokenized.pickupToken ?? "");

    const error = await backendError(backend.cancelMerchantOrder(placed.id));
    expect([error.code, error.message]).toEqual(["invalid_order_status", "Pesanan ini tidak dapat dibatalkan."]);
  });

  it("cancelling restores the merchant bag, notifies the consumer, and kills the pickup token", async () => {
    const backend = new FakeBackend();
    const token = (await backend.issuePickupToken(await activeOrder(backend, "order-1"))).pickupToken ?? "";
    const cancelled = await backend.cancelMerchantOrder("order-1");
    expect(cancelled).toMatchObject({ status: "cancelled", needsAction: false, redeemed: false });
    expect((await backend.myBags()).find((bag) => bag.id === "mb1")).toMatchObject({ sold: 4, quantityLeft: 4, statusNote: null });
    expect((await backend.notifications())[0]).toMatchObject({
      title: "Pesanan dibatalkan",
      body: "Surprise Bag Roti & Pastry telah dibatalkan oleh merchant.",
      type: "payment",
      route: "orders",
    });
    expect(await backend.redeemOrder(token)).toBeNull();
    expect((await backend.orderHistory())[0]).toMatchObject({ id: "order-1", status: "cancelled", canRate: false, pickupToken: null });
    expect((await backendError(backend.cancelMerchantOrder("missing"))).code).toBe("order_not_found");
  });
});

describe("ulasan terikat pesanan", () => {
  it("hanya order redeemed milik pengguna dan belum diulas yang diterima", async () => {
    const backend = new FakeBackend();
    const reviewsBefore = await backend.merchantReviews();
    const history = await backend.orderHistory();
    const redeemed = history.filter((order) => order.status === "done" && !order.reviewed);
    expect(redeemed).toHaveLength(1);
    const [active] = await backend.activeOrders();
    const unknown = orderRecord({
      id: "order-not-owned",
      bag: SampleData.bagRoti,
      code: "SB-NOT-OWNED",
      dateLabel: "Hari ini",
      amount: 16000,
      status: "done",
    });

    expect((await backendError(backend.submitReview(active, 5, [], ""))).code).toBe("order_not_redeemed");
    expect((await backendError(backend.submitReview(unknown, 5, [], ""))).code).toBe("order_not_redeemed");

    await backend.submitReview(redeemed[0], 5, ["Masih fresh"], "Bag sesuai deskripsi.");
    const reviewsAfter = await backend.merchantReviews();
    expect(reviewsAfter).toHaveLength(reviewsBefore.length + 1);
    expect(reviewsAfter[0].orderReference).toBe(redeemed[0].code);
    expect(reviewsAfter[0].rating).toBe(5);
    expect(reviewsAfter[0].tags).toContain("Masih fresh");
    expect(reviewsAfter[0].comment).toBe("Bag sesuai deskripsi.");
    expect((await backendError(backend.submitReview(redeemed[0], 4, [], ""))).code).toBe("already_reviewed");
  });

  it("rating must be 1–5; a review marks the order and notifies the merchant", async () => {
    const backend = new FakeBackend();
    const [order] = await backend.orderHistory();
    for (const rating of [0, 6]) {
      const error = await backendError(backend.submitReview(order, rating, [], ""));
      expect([error.code, error.message]).toEqual(["invalid_rating", "Pilih rating 1 sampai 5."]);
    }
    await backend.submitReview(order, 4, ["Ramah"], "  Enak.  ");
    expect((await backend.orderHistory())[0]).toMatchObject({ reviewed: true, canRate: false });
    expect((await backend.merchantReviews())[0]).toMatchObject({ customerName: "Ilham Hidayat", comment: "Enak.", orderId: order.id });
    expect((await backend.notifications())[0]).toMatchObject({
      title: "Ulasan baru",
      body: `4 bintang untuk ${order.code}.`,
      type: "rating",
      route: "merchant_reviews",
      unread: true,
    });
  });
});

describe("payout manual aman", () => {
  it("memvalidasi minimum, saldo, rekening terverifikasi, dan idempotency", async () => {
    const backend = new FakeBackend();
    const startingBalance = await backend.balance();
    const verified = (await backend.bankAccounts()).filter((account) => account.status === "verified");
    expect(verified).toHaveLength(1);

    expect(
      (await backendError(backend.requestPayout({ amount: 49999, bankAccountId: verified[0].id, idempotencyKey: "below-minimum" })))
        .code,
    ).toBe("minimum_payout");
    expect(
      (
        await backendError(
          backend.requestPayout({ amount: startingBalance + 1, bankAccountId: verified[0].id, idempotencyKey: "above-balance" }),
        )
      ).code,
    ).toBe("insufficient_balance");

    const unverified = await backend.saveBankAccount({
      bankCode: "BNI",
      bankName: "BNI",
      accountNumber: "1234567890",
      accountHolder: "Ilham Hidayat",
      idempotencyKey: "new-bank",
    });
    expect(unverified.status).not.toBe("verified");
    expect(
      (await backendError(backend.requestPayout({ amount: 50000, bankAccountId: unverified.id, idempotencyKey: "unverified-bank" })))
        .code,
    ).toBe("bank_not_verified");

    const first = await backend.requestPayout({ amount: 100000, bankAccountId: verified[0].id, idempotencyKey: "same-payout" });
    const retry = await backend.requestPayout({ amount: 100000, bankAccountId: verified[0].id, idempotencyKey: "same-payout" });

    expect(retry.id).toBe(first.id);
    expect(first.status).toBe("pending");
    expect(first.feeAmount).toBe(2500);
    expect(first.netAmount).toBe(first.grossAmount - first.feeAmount);
    expect(await backend.balance()).toBe(startingBalance - 100000);
    expect(await backend.payoutRequests()).toHaveLength(1);
  });

  it("a payout records a pending withdrawal; unknown accounts are rejected", async () => {
    const backend = new FakeBackend();
    await backend.requestPayout({ amount: 50000, bankAccountId: "bank-1", idempotencyKey: "withdraw-1" });
    expect((await backend.transactions())[0]).toMatchObject({
      title: "Penarikan ke BCA",
      subtitle: "Hari ini · menunggu diproses",
      amount: 50000,
      kind: "withdrawal",
      status: "pending",
    });
    const error = await backendError(backend.requestPayout({ amount: 50000, bankAccountId: "bank-x", idempotencyKey: "withdraw-2" }));
    expect([error.code, error.message]).toEqual(["bank_not_found", "Rekening tidak ditemukan."]);
  });

  it("bank accounts: idempotent save, validation, masking, and the default account", async () => {
    const backend = new FakeBackend();
    const input = {
      bankCode: "BNI",
      bankName: "BNI",
      accountNumber: "1234-5678-90",
      accountHolder: "  ilham hidayat ",
      idempotencyKey: "bank-save-1",
    };
    const saved = await backend.saveBankAccount(input);
    expect(saved).toMatchObject({ accountNumberMasked: "•••• 7890", accountHolder: "ILHAM HIDAYAT", status: "pending", isDefault: false });
    expect(await backend.saveBankAccount({ ...input, accountNumber: "0" })).toBe(saved);
    expect(await backend.bankAccounts()).toHaveLength(2);

    const error = await backendError(backend.saveBankAccount({ ...input, accountNumber: "1234567", idempotencyKey: "bank-save-2" }));
    expect([error.code, error.message]).toEqual(["invalid_bank_account", "Nomor rekening atau nama pemilik belum valid."]);
    expect((await backendError(backend.saveBankAccount({ ...input, accountHolder: "AB", idempotencyKey: "bank-save-3" }))).code).toBe(
      "invalid_bank_account",
    );

    await backend.setDefaultBankAccount(saved.id);
    expect((await backend.bankAccounts()).map((account) => [account.id, account.isDefault])).toEqual([
      ["bank-1", false],
      [saved.id, true],
    ]);
    const missing = await backendError(backend.setDefaultBankAccount("missing"));
    expect([missing.code, missing.message]).toEqual(["bank_account_not_found", "Rekening tidak ditemukan."]);
  });
});

describe("bag merchant", () => {
  it("duplikat bag memindahkan tanggal dan window pickup ke besok", async () => {
    const backend = new FakeBackend();
    const now = new Date();
    const available = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 30);
    const endsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21);
    await backend.addBag(
      bagInput({
        title: "Bag untuk diduplikat",
        pickupWindow: "19.30–21.00",
        total: 4,
        description: "Stok uji",
        contents: ["Croissant", "Danish"],
        availableOn: available,
        pickupStartsAt: startsAt,
        pickupEndsAt: endsAt,
      }),
    );
    const [source] = await backend.myBags();

    await backend.duplicateBag(source);
    const [duplicate] = await backend.myBags();
    const tomorrow = new Date(Date.now() + 24 * HOUR_MS);

    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.availableOn?.getFullYear()).toBe(tomorrow.getFullYear());
    expect(duplicate.availableOn?.getMonth()).toBe(tomorrow.getMonth());
    expect(duplicate.availableOn?.getDate()).toBe(tomorrow.getDate());
    expect(duplicate.pickupStartsAt?.getHours()).toBe(startsAt.getHours());
    expect(duplicate.pickupStartsAt?.getMinutes()).toBe(startsAt.getMinutes());
    expect(duplicate.pickupEndsAt?.getHours()).toBe(endsAt.getHours());
    expect(duplicate.sold).toBe(0);
    expect(duplicate.quantityLeft).toBe(source.total);
    expect(duplicate.active).toBe(true);
    expect(duplicate.contents).toEqual(source.contents);
  });

  it("duplicating a sold-out bag clears its status note", async () => {
    const backend = new FakeBackend();
    const soldOut = (await backend.myBags()).find((bag) => bag.id === "mb2");
    if (!soldOut) throw new Error("mb2 missing");
    await backend.duplicateBag(soldOut);
    expect((await backend.myBags())[0]).toMatchObject({ statusNote: null, active: true, sold: 0, quantityLeft: 8, pickupStartsAt: null });
  });

  it("create dan edit menyimpan daftar isi yang dinormalisasi", async () => {
    const backend = new FakeBackend();
    await backend.addBag(bagInput({ contents: [" Roti ", "roti", "Donat"] }));
    const [created] = await backend.myBags();
    expect(created.contents).toEqual(["Roti", "Donat"]);

    await backend.updateBag(created, {
      title: created.title,
      salePrice: created.salePrice,
      pickupWindow: created.pickupWindow,
      total: created.total,
      description: created.description,
      contents: ["Croissant", "Kopi susu"],
      originalPrice: created.originalPrice,
    });
    const [updated] = await backend.myBags();
    expect(updated.contents).toEqual(["Croissant", "Kopi susu"]);
  });

  it("backend demo menolak lebih dari 20 item atau item terlalu panjang", async () => {
    const backend = new FakeBackend();
    const add = (contents: string[]) => backend.addBag(bagInput({ title: "Bag Isi Invalid", contents }));

    expect((await backendError(add(Array.from({ length: 21 }, (_, index) => `Item ${index + 1}`)))).code).toBe(
      "invalid_bag_contents",
    );
    expect((await backendError(add(["x".repeat(81)]))).code).toBe("invalid_bag_contents");
  });

  it("new bags: defaults, validation, and the trimmed description", async () => {
    const backend = new FakeBackend();
    await backend.addBag(bagInput({ description: "  Isi.  " }));
    expect((await backend.myBags())[0]).toMatchObject({
      id: "mb100",
      image: SampleData.img1,
      active: true,
      sold: 0,
      quantityLeft: 3,
      description: "Isi.",
      statusNote: null,
    });
    for (const patch of [{ title: "   " }, { salePrice: 0 }, { originalPrice: 1000 }, { total: 0 }]) {
      const error = await backendError(backend.addBag(bagInput(patch)));
      expect([error.code, error.message]).toEqual(["invalid_bag", "Periksa nama, harga, dan jumlah bag."]);
    }
  });

  it("editing keeps the sold count, the image, and the dates unless replaced", async () => {
    const backend = new FakeBackend();
    const [bag] = await backend.myBags();
    const error = await backendError(
      backend.updateBag(bag, bagInput({ total: bag.sold - 1, originalPrice: 45000 })),
    );
    expect([error.code, error.message]).toEqual([
      "invalid_bag",
      "Jumlah total tidak boleh di bawah jumlah terjual dan harga asli harus valid.",
    ]);

    await backend.updateBag(bag, bagInput({ title: "Roti Baru", total: 10, imageUrl: null }));
    expect((await backend.myBags())[0]).toMatchObject({
      id: bag.id,
      title: "Roti Baru",
      total: 10,
      sold: 5,
      quantityLeft: 5,
      image: bag.image,
      active: true,
    });
  });

  it("deactivating keeps the note, reactivating clears it", async () => {
    const backend = new FakeBackend();
    const inactive = (await backend.myBags()).find((bag) => bag.id === "mb2");
    if (!inactive) throw new Error("mb2 missing");
    await backend.setBagActive(inactive, false);
    expect((await backend.myBags()).find((bag) => bag.id === "mb2")?.statusNote).toBe("Habis terjual kemarin");
    await backend.setBagActive(inactive, true);
    expect((await backend.myBags()).find((bag) => bag.id === "mb2")).toMatchObject({ active: true, statusNote: null });
  });
});

describe("profile, store, and account", () => {
  it("profile updates ignore blank fields and keep the last mode separately", async () => {
    const backend = new FakeBackend();
    await backend.updateProfile({ name: "  ", email: "", phone: " 0811 ", avatarUrl: "blob:avatar" });
    expect(await backend.currentProfile()).toEqual({
      id: "me",
      name: "Ilham Hidayat",
      email: "ilham@gmail.com",
      phone: "0811",
      avatarUrl: "blob:avatar",
      lastMode: "consumer",
      suspendedAt: null,
      suspendedReason: null,
    });
    await backend.setLastMode("merchant");
    expect((await backend.currentProfile())?.lastMode).toBe("merchant");
  });

  it("the store starts empty, keeps its id, and keeps the logo and point when omitted", async () => {
    const backend = new FakeBackend();
    expect(await backend.myStore()).toBeNull();
    await backend.upsertStore({ ...storeInput({ latitude: -6.37, longitude: 106.83 }), logoUrl: "blob:logo" });
    await backend.upsertStore({ ...storeInput({ name: "Nama Baru" }), latitude: null, longitude: null });
    expect(await backend.myStore()).toEqual({
      id: "store-me",
      name: "Nama Baru",
      category: "Bakery",
      address: "Jl. Demo No. 1, Depok",
      openTime: "08.00",
      closeTime: "21.00",
      description: "",
      logoUrl: "blob:logo",
      latitude: -6.37,
      longitude: 106.83,
      verificationStatus: "pending",
      verificationNote: null,
    });
  });

  it("hapus akun membersihkan seluruh data milik sesi demo", async () => {
    const backend = new FakeBackend();
    await backend.upsertStore({ ...storeInput({ name: "Toko Uji" }), address: "Jl. Pengujian No. 1", close: "20.00" });

    await backend.deleteAccount();

    expect(await backend.myStore()).toBeNull();
    expect(await backend.myBags()).toEqual([]);
    expect(await backend.activeOrders()).toEqual([]);
    expect(await backend.orderHistory()).toEqual([]);
    expect(await backend.incomingOrders()).toEqual([]);
    expect(await backend.transactions()).toEqual([]);
    expect(await backend.bankAccounts()).toEqual([]);
    expect(await backend.notifications()).toEqual([]);
    expect(await backend.merchantReviews()).toEqual([]);
    expect(await backend.favoriteMerchantIds()).toEqual(new Set());
    expect(await backend.balance()).toBe(0);
    expect((await backend.currentProfile())?.name).toBe("Pengguna");
  });

  it("business config is the safe default (payments and payouts off)", async () => {
    expect(await new FakeBackend().businessConfig()).toEqual(DEFAULT_BUSINESS_CONFIG);
  });

  it("is a local backend", () => {
    expect(new FakeBackend().isRemote).toBe(false);
  });
});

describe("realtime watchers", () => {
  it("semua watcher FakeBackend dapat dibatalkan setelah snapshot pertama", async () => {
    const backend = new FakeBackend();
    const receivesThenCancels = async (watch: (onData: (values: unknown[]) => void) => () => void) => {
      const received: unknown[][] = [];
      const firstValue = new Promise<void>((resolve) => {
        const unsubscribe = watch((values) => {
          received.push(values);
          unsubscribe();
          resolve();
        });
      });
      await firstValue;
      return received;
    };

    expect(await receivesThenCancels((onData) => backend.watchNotifications(onData, () => undefined))).toHaveLength(1);
    expect(await receivesThenCancels((onData) => backend.watchIncomingOrders(onData, () => undefined))).toHaveLength(1);
    expect(await receivesThenCancels((onData) => backend.watchTransactions(onData, () => undefined))).toHaveLength(1);
  });

  it("emit the current snapshot asynchronously, then after every change", async () => {
    const backend = new FakeBackend();
    const snapshots: AppNotification[][] = [];
    const unsubscribe = backend.watchNotifications((values) => snapshots.push(values), () => undefined);
    expect(snapshots).toHaveLength(0);
    await flush();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toHaveLength(4);

    await backend.markAllNotificationsRead();
    await flush();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].every((notification) => !notification.unread)).toBe(true);

    unsubscribe();
    await backend.markOrderReady("order-5");
    await flush();
    expect(snapshots).toHaveLength(2);
  });

  it("nothing is delivered after unsubscribing, not even values already queued", async () => {
    const backend = new FakeBackend();
    const received: AppNotification[][] = [];
    const stop = backend.watchNotifications((values) => received.push(values), () => undefined);
    void backend.markAllNotificationsRead();
    stop();
    await flush();
    expect(received).toEqual([]);
  });

  it("incoming orders and transactions follow orders, redemptions, and payouts", async () => {
    const backend = new FakeBackend();
    const incoming: number[] = [];
    const tx: number[] = [];
    const stopIncoming = backend.watchIncomingOrders((values) => incoming.push(values.length), () => undefined);
    const stopTx = backend.watchTransactions((values) => tx.push(values.length), () => undefined);
    await flush();

    await backend.placeOrder(SampleData.bagKopi, 1, "QRIS", "realtime-order");
    const token = (await backend.issuePickupToken(await activeOrder(backend, "order-1"))).pickupToken ?? "";
    await backend.redeemOrder(token);
    await backend.requestPayout({ amount: 50000, bankAccountId: "bank-1", idempotencyKey: "realtime-payout" });
    await flush();

    expect(incoming).toEqual([2, 3, 3]);
    expect(tx).toEqual([3, 4, 5]);
    stopIncoming();
    stopTx();
  });

  it("deleting the account pushes empty snapshots", async () => {
    const backend = new FakeBackend();
    const last: Record<string, number> = {};
    const stops = [
      backend.watchNotifications((values) => (last.notifications = values.length), () => undefined),
      backend.watchIncomingOrders((values) => (last.incoming = values.length), () => undefined),
      backend.watchTransactions((values) => (last.transactions = values.length), () => undefined),
    ];
    await flush();
    expect(last).toEqual({ notifications: 4, incoming: 2, transactions: 3 });
    await backend.deleteAccount();
    await flush();
    expect(last).toEqual({ notifications: 0, incoming: 0, transactions: 0 });
    for (const stop of stops) stop();
  });
});

describe("images (web only)", () => {
  it("uploadImage opens the picker synchronously and shows the chosen file locally", async () => {
    const backend = new FakeBackend();
    const file = new File([new Uint8Array([1, 2, 3])], "roti.png", { type: "image/png" });
    vi.mocked(pickImageFile).mockResolvedValueOnce(file);

    const pending = backend.uploadImage("bag");
    expect(pickImageFile).toHaveBeenCalledTimes(1);
    const url = await pending;
    expect(url).toMatch(/^blob:/);
  });

  it("uploadImage resolves null when the picker is cancelled", async () => {
    vi.mocked(pickImageFile).mockResolvedValueOnce(null);
    expect(await new FakeBackend().uploadImage("avatar")).toBeNull();
  });

  it("uploadImageBytes keeps the bytes and the image type", async () => {
    const backend = new FakeBackend();
    const url = await backend.uploadImageBytes("logo", new Uint8Array([137, 80, 78, 71]), "logo.PNG");
    expect(url).toMatch(/^blob:/);
    const blob = await fetchBlob(url ?? "");
    expect(blob?.type).toBe("image/png");
    expect(blob?.size).toBe(4);
    expect((await fetchBlob((await backend.uploadImageBytes("bag", new Uint8Array([1]), "photo")) ?? ""))?.type).toBe("image/jpeg");
  });
});

/** Node keeps object-URL blobs in `node:buffer`'s registry. */
async function fetchBlob(url: string): Promise<{ type: string; size: number } | undefined> {
  const { resolveObjectURL } = await import("node:buffer");
  return resolveObjectURL(url);
}

it("errors are BackendExceptions with Indonesian messages", async () => {
  const error = await backendError(new FakeBackend().toggleFavorite("nope"));
  expect(error).toBeInstanceOf(BackendException);
  expect(error.message).toBe("Toko tidak ditemukan atau sudah tidak aktif.");
});
