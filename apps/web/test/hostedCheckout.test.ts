// @vitest-environment jsdom
/**
 * The hosted Midtrans checkout: one idempotent order, then the tab goes
 * straight to the Midtrans page (every payment method). A paid order still
 * goes to the voucher and a failure keeps the customer on checkout.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { BackendException } from "../lib/backend/types";
import { orderRecord, type Bag, type OrderRecord } from "../lib/models";
import { SampleData } from "../lib/sampleData";

const nav = vi.hoisted(() => ({ toVoucher: vi.fn(), toResumePayment: vi.fn() }));
const state = vi.hoisted(() => ({ placeOrder: vi.fn(), recoverCheckout: vi.fn(), usesRemoteBackend: true }));
vi.mock("../lib/appNav", () => ({ AppNav: nav }));
vi.mock("../lib/appState", () => ({ appState: state }));

import {
  HOSTED_PAYMENT_METHOD,
  browser,
  resumeHostedPayment,
  startHostedCheckout,
} from "../screens/consumer/hostedCheckout";

// A client key that passes the Snap session validation (read lazily).
process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY = "Mid-client-test12345";

const MIDTRANS_PAGE = "https://app.sandbox.midtrans.com/snap/v4/redirection/0d8178e1-c6c7-4ab4-81a6-893be9d924ab";
const bag: Bag = SampleData.nearbyBags[0];

function order(fields: Partial<OrderRecord>): OrderRecord {
  return orderRecord({
    id: "order-1",
    bag,
    code: "SB-1",
    dateLabel: "Hari ini",
    amount: bag.salePrice + 1000,
    status: "pending",
    paymentMethod: HOSTED_PAYMENT_METHOD,
    ...fields,
  });
}

const awaiting = (fields: Partial<OrderRecord> = {}) =>
  order({ paymentState: "pending", paymentRedirectUrl: MIDTRANS_PAGE, paymentSnapToken: "snap-token-1234", ...fields });

let assign: Mock<(url: string) => void>;

beforeEach(() => {
  state.usesRemoteBackend = true;
  assign = vi.fn<(url: string) => void>();
  vi.spyOn(browser, "assign").mockImplementation(assign);
});

describe("startHostedCheckout", () => {
  it("creates the order for every method and goes straight to its Midtrans page", async () => {
    state.placeOrder.mockResolvedValue(awaiting());

    await expect(startHostedCheckout(bag, 2)).resolves.toEqual({ kind: "redirected" });

    expect(state.placeOrder).toHaveBeenCalledWith(bag, 2, "MIDTRANS");
    expect(assign).toHaveBeenCalledWith(MIDTRANS_PAGE);
    expect(nav.toResumePayment).not.toHaveBeenCalled();
  });

  it("sends a paid order to the voucher", async () => {
    const paid = order({ paymentState: "paid" });
    state.placeOrder.mockResolvedValue(paid);

    await expect(startHostedCheckout(bag, 1)).resolves.toEqual({ kind: "navigated" });

    expect(nav.toVoucher).toHaveBeenCalledWith(paid, { completeCheckout: true });
    expect(assign).not.toHaveBeenCalled();
  });

  it("recovers an order committed while the response was lost", async () => {
    state.placeOrder.mockRejectedValue(new Error("network"));
    state.recoverCheckout.mockResolvedValue(awaiting());

    await expect(startHostedCheckout(bag, 1)).resolves.toEqual({ kind: "redirected" });

    expect(state.recoverCheckout).toHaveBeenCalledWith(bag, 1, "MIDTRANS");
    expect(assign).toHaveBeenCalledWith(MIDTRANS_PAGE);
  });

  it("keeps the customer on checkout with the reason when no order exists", async () => {
    state.placeOrder.mockRejectedValue(new BackendException("insufficient_stock", "Stok tidak mencukupi."));
    state.recoverCheckout.mockResolvedValue(null);

    await expect(startHostedCheckout(bag, 1)).resolves.toEqual({ kind: "failed", message: "Stok tidak mencukupi." });

    state.placeOrder.mockRejectedValue(new Error("offline"));
    await expect(startHostedCheckout(bag, 1)).resolves.toEqual({
      kind: "failed",
      message: "Pembayaran belum dapat dibuat. Periksa koneksi lalu coba lagi.",
    });
    expect(assign).not.toHaveBeenCalled();
    expect(nav.toVoucher).not.toHaveBeenCalled();
  });

  it("explains an order that can no longer be paid", async () => {
    state.placeOrder.mockResolvedValue(order({ paymentState: "expired" }));

    await expect(startHostedCheckout(bag, 1)).resolves.toEqual({
      kind: "failed",
      message: "Waktu pembayaran berakhir. Stok yang ditahan sudah dikembalikan.",
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("never leaves for a page that is not an official Midtrans checkout", async () => {
    const foreign = awaiting({ paymentRedirectUrl: "https://evil.example/snap/v4/redirection/0d8178e1" });
    state.placeOrder.mockResolvedValue(foreign);

    await expect(startHostedCheckout(bag, 1)).resolves.toEqual({ kind: "navigated" });

    expect(assign).not.toHaveBeenCalled();
    expect(nav.toResumePayment).toHaveBeenCalledWith(foreign);
  });
});

describe("resumeHostedPayment", () => {
  it("continues an awaiting order on its Midtrans page", () => {
    resumeHostedPayment(awaiting());

    expect(assign).toHaveBeenCalledWith(MIDTRANS_PAGE);
    expect(nav.toResumePayment).not.toHaveBeenCalled();
  });

  it("opens the in-app payment screen for an order without a Midtrans page", () => {
    const legacy = awaiting({ paymentRedirectUrl: null, paymentSnapToken: null });

    resumeHostedPayment(legacy);

    expect(assign).not.toHaveBeenCalled();
    expect(nav.toResumePayment).toHaveBeenCalledWith(legacy);
  });
});
