/**
 * Supabase row → model mapping (`lib/mappers.ts`). Ports the mapping tests of
 * `test/filter_and_status_test.dart` and `test/finance_mapping_test.dart`,
 * plus the fallbacks of `lib/data/mappers.dart` the screens rely on.
 */
import { describe, expect, it } from "vitest";
import {
  bagFromMap,
  bankAccountFromMap,
  dateLabel,
  incomingOrderFromMap,
  initialOf,
  initials2,
  merchantBagFromMap,
  merchantFromMap,
  merchantReviewFromMap,
  notificationFromMap,
  orderRecordFromMap,
  parseDate,
  payoutRequestFromMap,
  profileFromMap,
  storeFromMap,
  timeLabel,
  txFromMap,
  type Row,
} from "../lib/mappers";
import { FALLBACK_IMAGE, bankLabel, bankVerified, customerInitial, isPaid } from "../lib/models";
import { C } from "../ui/theme";

describe("order status (filter_and_status_test)", () => {
  it("status cancelled dipetakan terpisah dari expired dan redeemed", () => {
    const row = (status: string): Row => ({
      id: `order-${status}`,
      status,
      order_reference: `SB-${status}`,
      quantity: 1,
      subtotal_amount: 15000,
      service_fee: 1000,
      total_amount: 16000,
      surprise_bags: {
        id: "bag-1",
        title: "Surprise Bag",
        sale_price: 15000,
        original_price: 45000,
        quantity_left: 1,
        quantity_total: 2,
        pickup_window: "20.00–21.00",
        merchants: { id: "merchant-1", store_name: "Toko Uji", category: "Bakery" },
      },
    });

    const cancelled = orderRecordFromMap(row("cancelled"));
    const expired = orderRecordFromMap(row("expired"));
    const redeemed = orderRecordFromMap(row("redeemed"));

    expect(cancelled.status).toBe("cancelled");
    expect(expired.status).toBe("expired");
    expect(redeemed.status).toBe("done");
    expect(cancelled.status).not.toBe(expired.status);
    expect(cancelled.status).not.toBe(redeemed.status);
    expect(cancelled.canRate).toBe(false);
    expect(redeemed.canRate).toBe(true);
    expect(cancelled.bag.merchant.name).toBe("Toko Uji");
    expect(cancelled.bag.title).toBe("Surprise Bag");
  });

  it("fulfilment statuses: pending/paid/preparing → pending, ready, refunded → cancelled, unknown → pending", () => {
    const status = (value: string) => orderRecordFromMap({ id: "o", status: value }).status;
    expect(status("pending")).toBe("pending");
    expect(status("paid")).toBe("pending");
    expect(status("preparing")).toBe("pending");
    expect(status("ready")).toBe("ready");
    expect(status("refunded")).toBe("cancelled");
    expect(status("future_status")).toBe("pending");
  });

  it("status pembayaran Midtrans tidak pernah jatuh ke siap/paid", () => {
    const row = (paymentStatus: string): Row => ({
      id: `order-${paymentStatus}`,
      status: paymentStatus === "settlement" ? "paid" : "pending",
      payment_status: paymentStatus,
      order_reference: `SB-${paymentStatus.toUpperCase()}`,
      quantity: 1,
      subtotal: 15000,
      service_fee: 1000,
      total_amount: 16000,
      bag_id: "bag-1",
      bag_title: "Surprise Bag",
      unit_price: 15000,
      original_price_snapshot: 45000,
      merchant_id: "merchant-1",
      merchant_name: "Toko Uji",
    });

    expect(orderRecordFromMap(row("pending")).paymentState).toBe("pending");
    expect(orderRecordFromMap(row("settlement")).paymentState).toBe("paid");
    expect(orderRecordFromMap({ ...row("capture"), fraud_status: "challenge" }).paymentState).toBe("pending");
    expect(orderRecordFromMap({ ...row("capture"), fraud_status: "accept" }).paymentState).toBe("paid");
    expect(orderRecordFromMap(row("deny")).paymentState).toBe("failed");
    expect(orderRecordFromMap(row("refund")).paymentState).toBe("refunded");
    expect(orderRecordFromMap(row("chargeback")).paymentState).toBe("disputed");
    expect(orderRecordFromMap(row("partial_refund")).paymentState).toBe("disputed");
    expect(orderRecordFromMap(row("refund")).status).toBe("pending");
    expect(isPaid(orderRecordFromMap(row("chargeback")).paymentState)).toBe(false);

    const unknownProviderState = { ...row("future_provider_status"), status: "ready", paid_at: "2026-07-19T08:00:00Z" };
    expect(orderRecordFromMap(unknownProviderState).paymentState).toBe("awaitingPayment");

    const verifiedLegacy = { ...row(""), status: "paid", paid_at: "2026-07-19T08:00:00Z" };
    expect(orderRecordFromMap(verifiedLegacy).paymentState).toBe("paid");
  });

  it("maps every provider spelling, case-insensitively", () => {
    const state = (payment_status: string, extra: Row = {}) =>
      orderRecordFromMap({ id: "o", payment_status, ...extra }).paymentState;
    expect(state("creating")).toBe("awaitingPayment");
    expect(state("checkout_created")).toBe("awaitingPayment");
    expect(state("NEW")).toBe("awaitingPayment");
    expect(state("capture", { fraud_status: "DENY" })).toBe("failed");
    expect(state("Settlement")).toBe("paid");
    expect(state("paid")).toBe("paid");
    expect(state("failure")).toBe("failed");
    expect(state("failed")).toBe("failed");
    expect(state("cancel")).toBe("cancelled");
    expect(state("cancelled")).toBe("cancelled");
    expect(state("expire")).toBe("expired");
    expect(state("expired")).toBe("expired");
    expect(state("refunded")).toBe("refunded");
    expect(state("partial_chargeback")).toBe("disputed");
    expect(state("disputed")).toBe("disputed");
    expect(state("", { payment_verified_at: "2026-07-19T08:00:00Z" })).toBe("paid");
    expect(state("")).toBe("awaitingPayment");
  });

  it("order memetakan dan mempertahankan URL QRIS", () => {
    const qrUrl = "https://api.sandbox.midtrans.com/v2/qris/order-map/qr-code";
    const simulatorQrUrl = "https://api.sandbox.midtrans.com/v2/qris/0d8178e1-c6c7-4ab4-81a6-893be9d924ab/qr-code";
    const snapToken = "opaqueSnapToken_123456";
    const order = orderRecordFromMap({
      id: "order-qris",
      status: "pending",
      payment_status: "pending",
      payment_qr_url: qrUrl,
      simulator_qr_image_url: simulatorQrUrl,
      payment_snap_token: snapToken,
      payment_redirect_url: "https://app.sandbox.midtrans.com/legacy",
      order_reference: "SB-QRIS",
      quantity: 1,
      subtotal: 15000,
      service_fee: 1000,
      total_amount: 16000,
      bag_id: "bag-1",
      bag_title: "Surprise Bag",
      unit_price: 15000,
      original_price_snapshot: 45000,
      merchant_id: "merchant-1",
      merchant_name: "Toko Uji",
    });

    expect(order.paymentMethod).toBe("QRIS");
    expect(order.paymentQrUrl).toBe(qrUrl);
    expect(order.simulatorQrImageUrl).toBe(simulatorQrUrl);
    expect(order.paymentSnapToken).toBe(snapToken);
    expect(order.paymentRedirectUrl).toBe("https://app.sandbox.midtrans.com/legacy");
    expect({ ...order, paymentState: "paid" }.paymentQrUrl).toBe(qrUrl);
    // A flat `consumer_orders` row: the bag comes from the order's own columns.
    expect(order.bag).toMatchObject({ id: "bag-1", title: "Surprise Bag", salePrice: 15000, originalPrice: 45000 });
    expect(order.bag.merchant).toMatchObject({ id: "merchant-1", name: "Toko Uji" });
  });

  it("order fallbacks: reference, quantity, subtotal, payment method, review state", () => {
    const order = orderRecordFromMap({
      id: "0d8178e1-c6c7-4ab4-81a6-893be9d924ab",
      status: "redeemed",
      quantity: 0,
      total_amount: 31000,
      service_fee: 1000,
      payment_method: "",
      pickup_token: "",
      payment_type: "qris",
      midtrans_order_id: "SB-MID-1",
      review_id: "review-1",
    });
    expect(order.code).toBe("SB-0D8178E1");
    expect(order.quantity).toBe(1);
    expect(order.subtotalAmount).toBe(30000);
    expect(order.paymentMethod).toBe("QRIS");
    expect(order.pickupToken).toBeNull();
    expect(order.providerPaymentType).toBe("qris");
    expect(order.providerOrderId).toBe("SB-MID-1");
    expect(order.reviewed).toBe(true);
    expect(order.canRate).toBe(false);

    expect(orderRecordFromMap({ id: "ab-c", status: "redeemed", reviewed: true }).canRate).toBe(false);
    expect(orderRecordFromMap({ id: "ab-c" }).code).toBe("SB-ABC00000");
    expect(orderRecordFromMap({ order_id: "from-view", id: "ignored" }).id).toBe("from-view");
  });

  it("status merchant yang tidak dikenal tidak dianggap sudah dibayar", () => {
    const unknown = incomingOrderFromMap({ id: "order-unknown", status: "future_status", consumer_name: "Nadia", quantity: 1 });

    expect(unknown.status).toBe("pending");
    expect(unknown.needsAction).toBe(false);
  });

  it("incoming orders: actionable only when paid/preparing; names and images fall back", () => {
    const incoming = (status: string, extra: Row = {}) => incomingOrderFromMap({ id: "o-1", status, ...extra });
    expect(incoming("paid").needsAction).toBe(true);
    expect(incoming("preparing").needsAction).toBe(true);
    expect(incoming("ready").needsAction).toBe(false);
    expect(incoming("redeemed")).toMatchObject({ status: "redeemed", redeemed: true, needsAction: false });
    expect(incoming("refunded").status).toBe("cancelled");
    expect(incoming("expired").status).toBe("expired");

    const fromProfile = incoming("paid", { profiles: { name: "Budi Santoso" }, quantity: 0 });
    expect(fromProfile).toMatchObject({ customer: "Budi Santoso", initial: "BS", bags: 1, bagImage: FALLBACK_IMAGE });
    expect(incoming("paid")).toMatchObject({ customer: "Pelanggan", initial: "P", code: "SB-O1000000" });
    expect(incoming("paid", { image_url: "https://cdn/bag.jpg", title: "Bag A", sale_price: 15000 })).toMatchObject({
      bagImage: "https://cdn/bag.jpg",
      bagTitle: "Bag A",
      unitPrice: 15000,
    });
  });
});

describe("notifications (filter_and_status_test)", () => {
  it("notifikasi diarahkan ke ekosistem pemilik yang tepat", () => {
    const notification = (entity: string, title: string) =>
      notificationFromMap({
        id: `${entity}-${title}`,
        entity_type: entity,
        title,
        body: "Uji",
        type: "order",
        group_label: "Hari ini",
        read: false,
        created_at: new Date().toISOString(),
      });

    expect(notification("order", "Pesanan baru").route).toBe("merchant_orders");
    expect(notification("order", "Pesanan siap").route).toBe("orders");
    expect(notification("review", "Ulasan baru").route).toBe("merchant_reviews");
    expect(notification("payout", "Penarikan diproses").route).toBe("merchant_balance");
    expect(notification("bank_account", "Rekening terverifikasi").route).toBe("merchant_balance");
    expect(notification("bag", "Surprise Bag baru").route).toBe("consumer_home");
    expect(notification("unknown", "Info").route).toBeNull();
  });

  it("maps type, read flag, group, and route precedence", () => {
    const base: Row = { id: "n-1", title: "T", body: "B" };
    expect(notificationFromMap({ ...base, type: "ready" }).type).toBe("ready");
    expect(notificationFromMap({ ...base, type: "newBag" }).type).toBe("newBag");
    expect(notificationFromMap({ ...base, type: "rating" }).type).toBe("rating");
    expect(notificationFromMap({ ...base, type: "order" }).type).toBe("payment");
    expect(notificationFromMap({ ...base, read: true }).unread).toBe(false);
    expect(notificationFromMap(base)).toMatchObject({ unread: true, group: "Hari ini", time: "", createdAt: null });
    expect(notificationFromMap({ ...base, group_label: "Kemarin" }).group).toBe("Kemarin");
    // Explicit route beats data.route, which beats dedupe_key and the entity fallback.
    expect(
      notificationFromMap({
        ...base,
        route: "ORDERS",
        data: { route: "merchant_balance" },
        dedupe_key: "order:o-1:paid",
        entity_type: "review",
      }).route,
    ).toBe("orders");
    expect(notificationFromMap({ ...base, data: { route: "merchant_balance" }, entity_type: "review" }).route).toBe(
      "merchant_balance",
    );
    expect(notificationFromMap({ ...base, dedupe_key: "order:o-1:paid", entity_type: "review" }).route).toBe(
      "order:o-1:paid",
    );
  });
});

describe("merchant data (filter_and_status_test)", () => {
  it("ulasan merchant memetakan identitas aman dan rincian pesanan", () => {
    const review = merchantReviewFromMap({
      review_id: "review-1",
      order_id: "order-1",
      order_reference: "SB-ABC12345",
      customer_name: "Nadia Putri",
      rating: 5,
      tags: ["Masih fresh", "Porsi banyak"],
      comment: "Bag sesuai deskripsi.",
      created_at: "2026-07-13T08:00:00Z",
    });

    expect(review.id).toBe("review-1");
    expect(review.orderId).toBe("order-1");
    expect(review.orderReference).toBe("SB-ABC12345");
    expect(review.customerName).toBe("Nadia Putri");
    expect(customerInitial(review)).toBe("NP");
    expect(review.rating).toBe(5);
    expect(review.tags).toHaveLength(2);
    expect(review.comment).toBe("Bag sesuai deskripsi.");
    expect(review.createdAt).not.toBeNull();
  });

  it("review fallbacks clamp the rating and drop blank tags", () => {
    expect(merchantReviewFromMap({ id: "r", rating: 9, tags: ["", " ", "Ramah"] })).toMatchObject({
      id: "r",
      rating: 5,
      tags: ["Ramah"],
      customerName: "Pelanggan",
      orderReference: "Pesanan",
    });
    expect(merchantReviewFromMap({ rating: 0 }).rating).toBe(1);
    expect(merchantReviewFromMap({ consumer_name: "Dimas Arya" }).customerName).toBe("Dimas Arya");
  });

  it("bag merchant memetakan perkiraan isi dari database", () => {
    const bag = merchantBagFromMap({
      id: "bag-merchant-1",
      title: "Surprise Bag Roti",
      sale_price: 15000,
      original_price: 45000,
      quantity_total: 5,
      quantity_left: 3,
      pickup_window: "20.00–21.00",
      status: "active",
      contents: ["Roti manis", "Croissant"],
    });

    expect(bag.contents).toEqual(["Roti manis", "Croissant"]);
    expect({ ...bag }.contents).toEqual(bag.contents);
    expect(bag).toMatchObject({ sold: 2, total: 5, quantityLeft: 3, active: true, statusNote: null, image: FALLBACK_IMAGE });
  });

  it("sold-out and inactive merchant bags", () => {
    expect(merchantBagFromMap({ id: "b", status: "sold_out", quantity_total: 4, quantity_left: 0 })).toMatchObject({
      active: false,
      statusNote: "Habis terjual",
      sold: 4,
      pickupWindow: "—",
    });
    expect(merchantBagFromMap({ id: "b", status: "inactive" }).active).toBe(false);
  });
});

describe("finance mapping (finance_mapping_test)", () => {
  it("withdrawal_reversal tetap dibedakan dari pendapatan order", () => {
    const record = txFromMap({
      id: "tx-reversal",
      kind: "withdrawal_reversal",
      title: "Saldo payout dikembalikan",
      subtitle: "Rekening tujuan ditolak",
      amount: 100000,
    });

    expect(record.kind).toBe("reversal");
    expect(record.title).toBe("Saldo payout dikembalikan");
    expect(record.amount).toBe(100000);
  });

  it("transaction kinds and default status", () => {
    expect(txFromMap({ kind: "withdrawal" }).kind).toBe("withdrawal");
    expect(txFromMap({ kind: "order_income" }).kind).toBe("income");
    expect(txFromMap({}).status).toBe("completed");
    expect(txFromMap({ status: "pending" }).status).toBe("pending");
  });

  it("status rekening rejected dan disabled tidak dianggap pending", () => {
    const rejected = bankAccountFromMap({
      id: "bank-r",
      bank_code: "BCA",
      account_number_last4: "1234",
      account_holder: "TEST USER",
      status: "rejected",
    });
    const disabled = bankAccountFromMap({
      id: "bank-d",
      bank_code: "BNI",
      account_number_last4: "5678",
      account_holder: "TEST USER",
      status: "disabled",
    });

    expect(rejected.status).toBe("rejected");
    expect(disabled.status).toBe("disabled");
    expect(bankVerified(rejected)).toBe(false);
    expect(bankVerified(disabled)).toBe(false);
  });

  it("nama bank kode-only memakai label yang ramah pengguna", () => {
    const bsi = bankAccountFromMap({
      id: "bank-bsi",
      bank_code: "BSI",
      bank_name: "BSI",
      account_number_last4: "1234",
      account_holder: "TEST USER",
      status: "pending",
    });
    const explicitName = bankAccountFromMap({
      id: "bank-custom",
      bank_code: "BCA",
      bank_name: "Bank Central Asia",
      account_number_last4: "5678",
      account_holder: "TEST USER",
      status: "pending",
    });

    expect(bsi.bankName).toBe("Bank Syariah Indonesia");
    expect(bankLabel(bsi)).toBe("Bank Syariah Indonesia · •••• 1234");
    expect(explicitName.bankName).toBe("Bank Central Asia");
  });

  it("bank code names, masking, the legacy verified flag, and the default flag", () => {
    const name = (code: string, bank_name = "") => bankAccountFromMap({ bank_code: code, bank_name }).bankName;
    expect(name("mandiri")).toBe("Bank Mandiri");
    expect(name("BRI")).toBe("BRI");
    expect(name("PERMATA")).toBe("Bank Permata");
    expect(name("CIMB")).toBe("CIMB Niaga");
    expect(name("BTN")).toBe("BTN");
    expect(name("BTN", "btn")).toBe("btn");
    expect(bankAccountFromMap({ account_number_masked: "•••• 0001", account_number_last4: "9999" }).accountNumberMasked).toBe(
      "•••• 0001",
    );
    expect(bankAccountFromMap({}).accountNumberMasked).toBe("••••");
    expect(bankAccountFromMap({ verified: true }).status).toBe("verified");
    expect(bankAccountFromMap({ status: "weird", verified: true }).status).toBe("verified");
    expect(bankAccountFromMap({ status: "weird" }).status).toBe("pending");
    expect(bankAccountFromMap({ bank_account_id: "b-9", is_default: true })).toMatchObject({ id: "b-9", isDefault: true });
  });

  it("payout requests read the nested bank account, the flat columns, or the given account", () => {
    const nested = payoutRequestFromMap({
      id: "payout-1",
      gross_amount: 100000,
      fee_amount: 2500,
      net_amount: 97500,
      status: "processing",
      requested_at: "2026-07-19T08:00:00Z",
      bank_accounts: { id: "bank-1", bank_code: "BCA", account_holder: "A", account_number_last4: "6789", status: "verified", is_default: true },
    });
    expect(nested).toMatchObject({ id: "payout-1", grossAmount: 100000, feeAmount: 2500, netAmount: 97500, status: "processing" });
    expect(nested.bankAccount).toMatchObject({ id: "bank-1", bankName: "BCA", accountNumberMasked: "•••• 6789" });
    expect(nested.createdAt?.toISOString()).toBe("2026-07-19T08:00:00.000Z");

    const flat = payoutRequestFromMap({
      payout_request_id: "payout-2",
      amount: 60000,
      fee_amount: 2500,
      status: "mystery",
      bank_account_id: "bank-2",
      bank_code: "BNI",
      account_number_last4: "1111",
    });
    expect(flat).toMatchObject({ id: "payout-2", grossAmount: 60000, netAmount: 57500, status: "pending" });
    expect(flat.bankAccount).toMatchObject({ id: "bank-2", bankName: "BNI", status: "verified" });

    const given = bankAccountFromMap({ id: "bank-3", bank_code: "BRI", status: "verified" });
    expect(payoutRequestFromMap({ id: "payout-3", bank_accounts: { id: "other" } }, given).bankAccount).toBe(given);
  });
});

describe("merchant, bag, profile, and store rows", () => {
  it("merchant defaults and the stable avatar palette", () => {
    const palette: string[] = [C.amberAvatar, C.greenBright, C.terracotta, C.greenAccent, C.brown, C.bca, C.ovo, C.green];
    const merchant = merchantFromMap({ id: "m-1" });
    expect(merchant).toMatchObject({
      id: "m-1",
      name: "Toko",
      initial: "?",
      hours: "08.00–21.00",
      coverImage: FALLBACK_IMAGE,
      rating: 0,
      reviewCount: 0,
      latitude: null,
      longitude: null,
    });
    expect(palette).toContain(merchant.avatarColor);
    expect(merchantFromMap({ id: "m-1" }).avatarColor).toBe(merchant.avatarColor);

    const prefixed = merchantFromMap({
      merchant_id: "m-2",
      merchant_name: "kopi senja",
      merchant_category: "Kafe",
      merchant_rating: "4.6",
      merchant_review_count: 98,
      merchant_open_time: "10.00",
      merchant_close_time: "22.00",
      merchant_logo_url: "https://cdn/logo.png",
      merchant_lat: -6.3762,
      merchant_lng: "106.8392",
    });
    expect(prefixed).toMatchObject({
      id: "m-2",
      name: "kopi senja",
      initial: "K",
      category: "Kafe",
      rating: 4.6,
      reviewCount: 98,
      hours: "10.00–22.00",
      coverImage: "https://cdn/logo.png",
      latitude: -6.3762,
      longitude: 106.8392,
    });
  });

  it("bag fallbacks: original price, image, sold out, contents, nested merchant", () => {
    const fromSnapshot = bagFromMap({ id: "b", sale_price: 15000, original_price_snapshot: 40000, quantity_left: 2 });
    expect(fromSnapshot.originalPrice).toBe(40000);
    expect(bagFromMap({ id: "b", sale_price: 15000 }).originalPrice).toBe(45000);
    expect(bagFromMap({ id: "b", quantity_left: 0 }).soldOut).toBe(true);
    expect(bagFromMap({ id: "b", quantity_left: 3, status: "sold_out" }).soldOut).toBe(true);
    expect(bagFromMap({ id: "b", quantity_left: 3, status: "active" }).soldOut).toBe(false);
    expect(bagFromMap({ id: "b", bag_image_url: "https://cdn/b.jpg" }).image).toBe("https://cdn/b.jpg");
    expect(bagFromMap({ id: "b" })).toMatchObject({ image: FALLBACK_IMAGE, contents: [], availableOn: null });
    expect(bagFromMap({ id: "b", merchant: { id: "m-9", store_name: "Nested" } }).merchant).toMatchObject({
      id: "m-9",
      name: "Nested",
    });
    expect(bagFromMap({ id: "b", available_on: "2026-07-19" }).availableOn?.getTime()).toBe(new Date(2026, 6, 19).getTime());
  });

  it("profile and store defaults", () => {
    expect(profileFromMap({ id: "u-1" })).toEqual({
      id: "u-1",
      name: "Pengguna",
      email: "",
      phone: "",
      avatarUrl: null,
      lastMode: "consumer",
      suspendedAt: null,
      suspendedReason: null,
    });
    expect(profileFromMap({ id: "u-1", last_mode: "merchant", avatar_url: "https://cdn/a.png" })).toMatchObject({
      lastMode: "merchant",
      avatarUrl: "https://cdn/a.png",
    });
    expect(storeFromMap({ id: "s-1", store_name: "Toko" })).toEqual({
      id: "s-1",
      name: "Toko",
      category: "Bakery",
      address: "",
      openTime: "08.00",
      closeTime: "21.00",
      description: "",
      logoUrl: null,
      latitude: null,
      longitude: null,
      verificationStatus: "verified",
      verificationNote: null,
    });
    expect(storeFromMap({ lat: "-6.372", lng: 106.8318 })).toMatchObject({ latitude: -6.372, longitude: 106.8318 });
  });

  it("initials", () => {
    expect(initialOf("  roti nyaman ")).toBe("R");
    expect(initialOf("")).toBe("?");
    expect(initialOf(null)).toBe("?");
    expect(initials2("rani anggraini")).toBe("RA");
    expect(initials2("Budi")).toBe("B");
    expect(initials2("   ")).toBe("?");
    expect(initials2(undefined)).toBe("?");
  });
});

describe("dates", () => {
  it("parseDate reads date-only and offset-less values as local time, like Dart", () => {
    expect(parseDate("2026-07-19")?.getTime()).toBe(new Date(2026, 6, 19).getTime());
    expect(parseDate("2026-07-19 08:00:00")?.getTime()).toBe(new Date(2026, 6, 19, 8).getTime());
    expect(parseDate("2026-07-19T08:00:00")?.getTime()).toBe(new Date(2026, 6, 19, 8).getTime());
    expect(parseDate("2026-07-19T08:00:00Z")?.toISOString()).toBe("2026-07-19T08:00:00.000Z");
    expect(parseDate("2026-07-19T08:00:00.123456+07:00")?.toISOString()).toBe("2026-07-19T01:00:00.123Z");
    const date = new Date(2026, 0, 1);
    expect(parseDate(date)).toBe(date);
    for (const invalid of [null, undefined, "", "bukan tanggal", new Date(Number.NaN), {}]) {
      expect(parseDate(invalid)).toBeNull();
    }
  });

  it("dateLabel: 'Hari ini' for today, otherwise day + Indonesian month", () => {
    expect(dateLabel(new Date().toISOString())).toBe("Hari ini");
    expect(dateLabel("2020-01-15")).toBe("15 Jan");
    expect(dateLabel("2020-05-01T10:00:00")).toBe("1 Mei");
    expect(dateLabel("2020-08-17")).toBe("17 Agu");
    expect(dateLabel("2020-10-04T10:00:00")).toBe("4 Okt");
    expect(dateLabel("2020-12-31")).toBe("31 Des");
    expect(dateLabel(null)).toBe("");
  });

  it("timeLabel: local HH.mm", () => {
    expect(timeLabel(new Date(2026, 6, 19, 8, 5).toISOString())).toBe("08.05");
    expect(timeLabel("2026-07-19 18:42:00")).toBe("18.42");
    expect(timeLabel("")).toBe("");
  });
});
