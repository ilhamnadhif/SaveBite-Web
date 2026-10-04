/**
 * The hosted Midtrans checkout of the web app.
 *
 * SaveBite creates (or resumes) the order, then hands the whole tab to the
 * Midtrans Snap page, where the customer picks any payment method active on
 * the merchant account. Midtrans sends the browser back through the
 * `midtrans-return` Edge Function to `/?savebite_payment_return=1`, which
 * opens the orders tab and asks the server for the payment status.
 */
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import { isAwaitingCustomer, isPaid, type Bag, type OrderRecord } from "../../lib/models";
import { SnapCheckoutSession } from "./snapCheckoutSession";

/** The checkout kind the web requests: every method on the Midtrans page. */
export const HOSTED_PAYMENT_METHOD = "MIDTRANS";

/** The browser navigation used to leave for Midtrans (replaced in tests). */
export const browser = {
  assign: (url: string) => window.location.assign(url),
};

/** The validated Midtrans page of `order`, or null when it has none. */
export function hostedPaymentUrl(order: OrderRecord): string | null {
  return SnapCheckoutSession.tryParse(order.paymentRedirectUrl, { snapToken: order.paymentSnapToken })?.redirectUri ?? null;
}

/**
 * Continues the payment of an order awaiting the customer: straight to its
 * Midtrans page, or the in-app payment screen for an order without one (a
 * historical QR checkout).
 */
export function resumeHostedPayment(order: OrderRecord) {
  const url = hostedPaymentUrl(order);
  if (url !== null) browser.assign(url);
  else AppNav.toResumePayment(order);
}

/**
 * What happened to the checkout: the tab is leaving for Midtrans, the app
 * navigated (voucher or in-app payment screen), or `message` explains why the
 * customer has to try again.
 */
export type HostedCheckoutResult = { kind: "redirected" } | { kind: "navigated" } | { kind: "failed"; message: string };

function failureMessage(order: OrderRecord): string {
  switch (order.paymentState) {
    case "expired":
      return "Waktu pembayaran berakhir. Stok yang ditahan sudah dikembalikan.";
    case "cancelled":
      return "Pembayaran dibatalkan.";
    case "refunded":
      return "Pembayaran pesanan ini sudah dikembalikan.";
    case "disputed":
      return "Pembayaran sedang ditinjau. Hubungi bantuan jika memerlukan informasi.";
    default:
      return "Pembayaran ditolak atau tidak berhasil.";
  }
}

/**
 * Creates one idempotent order for this checkout and sends the customer to
 * its Midtrans page. Like the mobile `ProcessingScreen`, a response lost
 * after the order was committed is recovered from the active orders, a paid
 * order goes to the voucher, and only the server decides the payment state.
 */
export async function startHostedCheckout(bag: Bag, qty: number): Promise<HostedCheckoutResult> {
  let order: OrderRecord;
  try {
    // AppState reuses the persisted key of this checkout, so a retry after a
    // failure or a reload reaches the same order and the same Midtrans page.
    order = await appState.placeOrder(bag, qty, HOSTED_PAYMENT_METHOD);
  } catch (error) {
    const recovered = appState.usesRemoteBackend
      ? await appState.recoverCheckout(bag, qty, HOSTED_PAYMENT_METHOD).catch(() => null)
      : null;
    if (recovered === null) {
      return {
        kind: "failed",
        message: error instanceof BackendException ? error.message : "Pembayaran belum dapat dibuat. Periksa koneksi lalu coba lagi.",
      };
    }
    order = recovered;
  }

  if (isPaid(order.paymentState)) {
    AppNav.toVoucher(order, { completeCheckout: true });
    return { kind: "navigated" };
  }
  if (!isAwaitingCustomer(order.paymentState)) {
    return { kind: "failed", message: failureMessage(order) };
  }
  const url = hostedPaymentUrl(order);
  if (url === null) {
    AppNav.toResumePayment(order);
    return { kind: "navigated" };
  }
  browser.assign(url);
  return { kind: "redirected" };
}
