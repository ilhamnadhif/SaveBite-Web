/**
 * Domain model helpers (`lib/models.ts`): the BagFilter parts of
 * `test/filter_and_status_test.dart`, the bag-contents parser tests of
 * `test/fake_backend_test.dart`, and the Dart getters/constructors the web
 * port turned into functions.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER,
  FALLBACK_IMAGE,
  assetUrl,
  bagContentsValidationError,
  bagMatchesFilter,
  bankLabel,
  bankVerified,
  copyIncomingOrder,
  customerInitial,
  discountPercent,
  formatRupiah,
  incomingOrder,
  isAwaitingCustomer,
  isFilterEmpty,
  isPaid,
  isTerminalFailure,
  merchantBag,
  normalizeBagContents,
  orderRecord,
  parseBagContents,
  savings,
  type Bag,
  type BagFilter,
  type Merchant,
  type PaymentState,
} from "../lib/models";

const merchant: Merchant = {
  id: "m-filter",
  name: "Toko Filter",
  initial: "TF",
  avatarColor: "#1E8456",
  category: "Bakery",
  rating: 4.5,
  reviewCount: 1,
  distance: "1.2 km",
  address: "Depok",
  hours: "08.00–21.00",
  coverImage: "",
  bagsSaved: 1,
  latitude: null,
  longitude: null,
};

function bag(fields: Partial<Bag> = {}): Bag {
  return {
    id: "bag",
    merchant,
    title: "Bag",
    description: "Isi",
    originalPrice: 30000,
    salePrice: 10000,
    quantityLeft: 1,
    quantityTotal: 1,
    pickupWindow: "17.00–18.00",
    image: "",
    contents: [],
    soldOut: false,
    availableOn: null,
    pickupStartsAt: null,
    pickupEndsAt: null,
    ...fields,
  };
}

const filter = (fields: Partial<BagFilter>): BagFilter => ({ ...EMPTY_FILTER, ...fields });

describe("formatRupiah", () => {
  it.each([
    [0, "Rp0"],
    [999, "Rp999"],
    [1000, "Rp1.000"],
    [15000, "Rp15.000"],
    [120000, "Rp120.000"],
    [1245000, "Rp1.245.000"],
  ])("%d → %s", (value, text) => {
    expect(formatRupiah(value)).toBe(text);
  });
});

describe("perkiraan isi bag", () => {
  it("parser menerima koma/baris baru dan menghapus duplikat", () => {
    const parsed = parseBagContents(" Roti manis, Croissant\nroti MANIS; Donat ");

    expect(parsed).toEqual(["Roti manis", "Croissant", "Donat"]);
    expect(bagContentsValidationError(parsed)).toBeNull();
    expect(bagContentsValidationError(Array.from({ length: 21 }, (_, index) => `Item ${index + 1}`))).toBe(
      "Maksimal 20 item",
    );
    expect(bagContentsValidationError(["x".repeat(81)])).toBe("Setiap item maksimal 80 karakter");
  });

  it("normalisation keeps the first spelling and drops blanks", () => {
    expect(normalizeBagContents([" Roti ", "roti", "", "   ", "Donat", "DONAT"])).toEqual(["Roti", "Donat"]);
    expect(parseBagContents("a;;b\r\n\r\nc,,")).toEqual(["a", "b", "c"]);
  });

  it("limits count duplicates and whitespace only once", () => {
    const twenty = Array.from({ length: 20 }, (_, index) => `Item ${index + 1}`);
    expect(bagContentsValidationError(twenty)).toBeNull();
    expect(bagContentsValidationError([...twenty, "item 1", " Item 2 "])).toBeNull();
    expect(bagContentsValidationError(["x".repeat(80)])).toBeNull();
    expect(bagContentsValidationError([`  ${"x".repeat(80)}  `])).toBeNull();
  });
});

describe("Bag getters", () => {
  it("discountPercent rounds and clamps like Dart", () => {
    expect(discountPercent({ originalPrice: 45000, salePrice: 15000 })).toBe(67);
    expect(discountPercent({ originalPrice: 50000, salePrice: 20000 })).toBe(60);
    expect(discountPercent({ originalPrice: 0, salePrice: 15000 })).toBe(0);
    expect(discountPercent({ originalPrice: 10000, salePrice: 15000 })).toBe(0);
    expect(discountPercent({ originalPrice: 10000, salePrice: 0 })).toBe(100);
  });

  it("savings never goes negative or above the original price", () => {
    expect(savings({ originalPrice: 45000, salePrice: 15000 })).toBe(30000);
    expect(savings({ originalPrice: 10000, salePrice: 15000 })).toBe(0);
    expect(savings({ originalPrice: 10000, salePrice: -5000 })).toBe(10000);
  });
});

describe("PaymentState", () => {
  const states: PaymentState[] = [
    "awaitingPayment",
    "pending",
    "paid",
    "failed",
    "cancelled",
    "expired",
    "refunded",
    "disputed",
  ];

  it("separates paid, awaiting customer, and terminal failures", () => {
    expect(states.filter(isPaid)).toEqual(["paid"]);
    expect(states.filter(isAwaitingCustomer)).toEqual(["awaitingPayment", "pending"]);
    expect(states.filter(isTerminalFailure)).toEqual(["failed", "cancelled", "expired", "refunded", "disputed"]);
  });
});

describe("constructors with Dart defaults", () => {
  it("orderRecord defaults to a paid QRIS order of one bag", () => {
    const order = orderRecord({ bag: bag(), code: "SB-1", dateLabel: "Hari ini", amount: 16000, status: "pending" });
    expect(order).toMatchObject({
      id: "",
      reviewed: false,
      canRate: false,
      quantity: 1,
      paymentMethod: "QRIS",
      paymentState: "paid",
      pickupToken: null,
      subtotalAmount: 0,
      serviceFee: 0,
      merchantNetAmount: 0,
    });
  });

  it("merchantBag derives quantityLeft unless it is given", () => {
    const base = { id: "mb", title: "Bag", salePrice: 1, pickupWindow: "—", image: "", active: true };
    expect(merchantBag({ ...base, sold: 5, total: 8 }).quantityLeft).toBe(3);
    expect(merchantBag({ ...base, sold: 5, total: 8, quantityLeft: 1 }).quantityLeft).toBe(1);
    expect(merchantBag({ ...base, sold: 0, total: 2 })).toMatchObject({
      statusNote: null,
      description: "",
      contents: [],
      originalPrice: 0,
    });
  });

  it("incomingOrder derives the status from `redeemed` unless a status is given", () => {
    const base = { customer: "Rani", initial: "R", time: "18.42", bags: 1, code: "SB-1" };
    expect(incomingOrder(base)).toMatchObject({ status: "paid", needsAction: true, redeemed: false });
    expect(incomingOrder({ ...base, redeemed: true }).status).toBe("redeemed");
    expect(incomingOrder({ ...base, status: "ready" }).status).toBe("ready");
    expect(incomingOrder({ ...base, status: null }).status).toBe("paid");
  });

  it("copyIncomingOrder: `redeemed: true` always wins the status", () => {
    const order = incomingOrder({ customer: "Rani", initial: "R", time: "18.42", bags: 1, code: "SB-1", status: "ready" });
    const redeemedAt = new Date(2026, 6, 19, 18, 50);
    expect(copyIncomingOrder(order, { redeemed: true, status: "cancelled", redeemedAt })).toMatchObject({
      status: "redeemed",
      redeemed: true,
      redeemedAt,
    });
    expect(copyIncomingOrder(order, { status: "cancelled", needsAction: false })).toMatchObject({
      status: "cancelled",
      needsAction: false,
      redeemedAt: null,
    });
    expect(copyIncomingOrder(order, {})).toEqual(order);
  });
});

describe("MerchantReview.customerInitial", () => {
  it("uses up to two initials", () => {
    expect(customerInitial({ customerName: "Nadia Putri" })).toBe("NP");
    expect(customerInitial({ customerName: "  nadia   putri  sari " })).toBe("NP");
    expect(customerInitial({ customerName: "dimas" })).toBe("D");
    expect(customerInitial({ customerName: "   " })).toBe("?");
  });
});

describe("BankAccount getters", () => {
  it("label and verified", () => {
    const account = {
      id: "bank-1",
      bankCode: "BCA",
      bankName: "BCA",
      accountNumberMasked: "•••• 6789",
      accountHolder: "ILHAM HIDAYAT",
      status: "verified" as const,
      isDefault: true,
    };
    expect(bankLabel(account)).toBe("BCA · •••• 6789");
    expect(bankVerified(account)).toBe(true);
    expect(bankVerified({ status: "pending" })).toBe(false);
    expect(bankVerified({ status: "rejected" })).toBe(false);
  });
});

describe("BagFilter", () => {
  it("a full filter is not empty; clearing every criterion empties it", () => {
    const initial = filter({
      categories: new Set(["Bakery"]),
      maxDistanceKm: 2,
      minPrice: 10000,
      maxPrice: 25000,
      pickupAfter: { hour: 17, minute: 0 },
      pickupBefore: { hour: 21, minute: 0 },
    });
    expect(isFilterEmpty(initial)).toBe(false);

    const cleared: BagFilter = {
      ...initial,
      categories: new Set(),
      maxDistanceKm: null,
      minPrice: null,
      maxPrice: null,
      pickupAfter: null,
      pickupBefore: null,
    };
    expect(isFilterEmpty(cleared)).toBe(true);
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true);
    expect(Object.isFrozen(EMPTY_FILTER)).toBe(true);
    expect(isFilterEmpty(filter({ categories: new Set(["Kafe"]) }))).toBe(false);
    expect(isFilterEmpty(filter({ maxDistanceKm: 1 }))).toBe(false);
    expect(isFilterEmpty(filter({ minPrice: 0 }))).toBe(false);
    expect(isFilterEmpty(filter({ maxPrice: 0 }))).toBe(false);
    expect(isFilterEmpty(filter({ pickupAfter: { hour: 0, minute: 0 } }))).toBe(false);
    expect(isFilterEmpty(filter({ pickupBefore: { hour: 0, minute: 0 } }))).toBe(false);
  });

  it("aturan pickup memakai irisan window dan menolak data tak diketahui", () => {
    const pickup = filter({ pickupAfter: { hour: 18, minute: 0 }, pickupBefore: { hour: 20, minute: 0 } });

    expect(bagMatchesFilter(bag({ pickupWindow: "17.30–18.30" }), pickup)).toBe(true);
    expect(bagMatchesFilter(bag({ pickupWindow: "20.30–21.00" }), pickup)).toBe(false);
    expect(bagMatchesFilter(bag({ pickupWindow: "jadwal menyusul" }), pickup)).toBe(false);
  });

  it("pickup windows accept dots, colons, and hyphen/en/em dashes; invalid times are unknown", () => {
    const pickup = filter({ pickupAfter: { hour: 18, minute: 0 } });
    expect(bagMatchesFilter(bag({ pickupWindow: "17:30 - 18:30" }), pickup)).toBe(true);
    expect(bagMatchesFilter(bag({ pickupWindow: "17.30—18.30" }), pickup)).toBe(true);
    expect(bagMatchesFilter(bag({ pickupWindow: "16.00–17.59" }), pickup)).toBe(false);
    expect(bagMatchesFilter(bag({ pickupWindow: "17.30–24.00" }), pickup)).toBe(false);
    expect(bagMatchesFilter(bag({ pickupWindow: "17.60–18.30" }), pickup)).toBe(false);
  });

  it("explicit pickup timestamps win over the window text (local clock)", () => {
    const pickup = filter({ pickupBefore: { hour: 9, minute: 0 } });
    const morning = bag({
      pickupWindow: "20.00–21.00",
      pickupStartsAt: new Date(2026, 6, 19, 8, 30),
      pickupEndsAt: new Date(2026, 6, 19, 9, 30),
    });
    expect(bagMatchesFilter(morning, pickup)).toBe(true);
    expect(bagMatchesFilter(bag({ pickupWindow: "20.00–21.00" }), pickup)).toBe(false);
  });

  it("sold-out bags never match, even with an empty filter", () => {
    expect(bagMatchesFilter(bag(), EMPTY_FILTER)).toBe(true);
    expect(bagMatchesFilter(bag({ soldOut: true }), EMPTY_FILTER)).toBe(false);
    expect(bagMatchesFilter(bag({ quantityLeft: 0 }), EMPTY_FILTER)).toBe(false);
  });

  it("categories are case-insensitive; prices are inclusive", () => {
    expect(bagMatchesFilter(bag(), filter({ categories: new Set(["bakery"]) }))).toBe(true);
    expect(bagMatchesFilter(bag(), filter({ categories: new Set(["Kafe", "Resto"]) }))).toBe(false);
    expect(bagMatchesFilter(bag({ salePrice: 15000 }), filter({ minPrice: 15000, maxPrice: 15000 }))).toBe(true);
    expect(bagMatchesFilter(bag({ salePrice: 14999 }), filter({ minPrice: 15000 }))).toBe(false);
    expect(bagMatchesFilter(bag({ salePrice: 15001 }), filter({ maxPrice: 15000 }))).toBe(false);
  });

  it("distance reads both `0,4 km` and `1.2 km`; unknown distances are excluded", () => {
    const at = (distance: string) => bag({ merchant: { ...merchant, distance } });
    expect(bagMatchesFilter(at("0,4 km"), filter({ maxDistanceKm: 0.5 }))).toBe(true);
    expect(bagMatchesFilter(at("1.2 km"), filter({ maxDistanceKm: 1 }))).toBe(false);
    expect(bagMatchesFilter(at("1.0 km"), filter({ maxDistanceKm: 1 }))).toBe(true);
    expect(bagMatchesFilter(at("Lokasi toko"), filter({ maxDistanceKm: 50 }))).toBe(false);
    expect(bagMatchesFilter(at(""), filter({ maxDistanceKm: 50 }))).toBe(false);
  });
});

describe("assetUrl", () => {
  it("maps Flutter asset paths to the public images folder and leaves URLs alone", () => {
    expect(assetUrl("assets/images/food1.jpg")).toBe("/images/food1.jpg");
    expect(assetUrl("https://x.supabase.co/storage/v1/object/public/bag-images/a.jpg")).toBe(
      "https://x.supabase.co/storage/v1/object/public/bag-images/a.jpg",
    );
    expect(assetUrl("blob:http://localhost/123")).toBe("blob:http://localhost/123");
    expect(FALLBACK_IMAGE).toBe(assetUrl("assets/images/food1.jpg"));
  });
});
