// @vitest-environment jsdom
/**
 * The non-widget parts of `test/payment_flow_test.dart`: checkout
 * idempotency, recovery of a committed order whose response was lost, and
 * the rule that only the server's payment status can mark an order paid.
 * (The ProcessingScreen widget tests are covered by the screen port.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppState } from "../lib/appState";
import { FakeBackend } from "../lib/backend/fake";
import { BackendException } from "../lib/backend/types";
import { isPaid, orderRecord, type Bag, type OrderRecord } from "../lib/models";
import { SampleData } from "../lib/sampleData";
import { backendError, flush, resetSession, useBackend } from "./support/harness";

const QR_URL = "https://api.sandbox.midtrans.com/v2/qris/0d8178e1-c6c7-4ab4-81a6-893be9d924ab/qr-code";
const MINUTE_MS = 60_000;

function pendingOrder(bag: Bag, qty: number, method: string, fields: Partial<OrderRecord> = {}): OrderRecord {
  return orderRecord({
    id: "order-midtrans-1",
    bag,
    code: "SB-MIDTRANS",
    dateLabel: "Hari ini",
    amount: bag.salePrice * qty + 1000,
    status: "pending",
    quantity: qty,
    paymentMethod: method,
    subtotalAmount: bag.salePrice * qty,
    serviceFee: 1000,
    paymentState: "pending",
    paymentExpiresAt: new Date(Date.now() + 15 * MINUTE_MS),
    ...fields,
  });
}

class VerifiedPaymentBackend extends FakeBackend {
  override readonly isRemote = true;
  readonly keys: string[] = [];
  createCalls = 0;
  statusCalls = 0;

  override async placeOrder(bag: Bag, qty: number, method: string, idempotencyKey: string): Promise<OrderRecord> {
    this.createCalls++;
    this.keys.push(idempotencyKey);
    return pendingOrder(bag, qty, method, { paymentQrUrl: QR_URL });
  }

  override async refreshPayment(order: OrderRecord): Promise<OrderRecord> {
    this.statusCalls++;
    return { ...order, paymentState: "paid" };
  }
}

class CommitThenLoseResponseBackend extends FakeBackend {
  override readonly isRemote = true;
  readonly keys: string[] = [];
  private lostFirstResponse = false;
  committedOrderId: string | null = null;

  override async placeOrder(bag: Bag, qty: number, method: string, idempotencyKey: string): Promise<OrderRecord> {
    this.keys.push(idempotencyKey);
    const order = await super.placeOrder(bag, qty, method, idempotencyKey);
    this.committedOrderId = order.id;
    if (!this.lostFirstResponse) {
      this.lostFirstResponse = true;
      throw new BackendException("response_lost", "Respons checkout terputus setelah order tersimpan.");
    }
    return order;
  }
}

class RemoteQuantityProbeBackend extends FakeBackend {
  override readonly isRemote = true;
  reachedServer = false;

  override async placeOrder(bag: Bag, qty: number, method: string): Promise<OrderRecord> {
    this.reachedServer = true;
    return pendingOrder(bag, qty, method, { id: "server-validated-order", code: "SB-SERVER" });
  }
}

class RetryQrisBackend extends FakeBackend {
  override readonly isRemote = true;
  readonly keys: string[] = [];
  createCalls = 0;

  override async placeOrder(bag: Bag, qty: number, method: string, idempotencyKey: string): Promise<OrderRecord> {
    this.createCalls++;
    this.keys.push(idempotencyKey);
    return pendingOrder(bag, qty, method, {
      id: "retry-qris-order",
      code: "SB-RETRYQR",
      paymentQrUrl: this.createCalls > 1 ? QR_URL : null,
    });
  }

  override async refreshPayment(order: OrderRecord): Promise<OrderRecord> {
    return order;
  }
}

class SandboxSimulatorBackend extends FakeBackend {
  override readonly isRemote = true;
  statusCalls = 0;

  override async refreshPayment(order: OrderRecord): Promise<OrderRecord> {
    this.statusCalls++;
    return { ...order, simulatorQrImageUrl: QR_URL };
  }
}

let state: AppState;

beforeEach(() => {
  localStorage.clear();
  state = resetSession();
});

afterEach(async () => {
  await state.clearSessionState({ notify: false });
  await flush();
});

describe("payment_flow_test (logic)", () => {
  it("order hasil restore menyerahkan validasi stok ke server", async () => {
    const backend = useBackend(new RemoteQuantityProbeBackend());
    const restoredBag: Bag = { ...SampleData.bagRoti, quantityLeft: 0, soldOut: true };

    await state.placeOrder(restoredBag, 1, "QRIS");

    expect(backend.reachedServer).toBe(true);
  });

  it("the order is only paid after the server's payment status says so", async () => {
    const backend = useBackend(new VerifiedPaymentBackend());

    const order = await state.placeOrder(SampleData.bagRoti, 1, "QRIS", { idempotencyKey: "checkout-test-1" });
    expect(backend.createCalls).toBe(1);
    expect(backend.keys).toEqual(["checkout-test-1"]);
    expect(isPaid(order.paymentState)).toBe(false);
    expect(order.paymentQrUrl).toBe(QR_URL);
    expect(state.findOrder(order.id)?.paymentState).toBe("pending");

    const refreshed = await state.refreshPayment(order);
    expect(backend.statusCalls).toBe(1);
    expect(isPaid(refreshed.paymentState)).toBe(true);
    expect(state.findOrder(order.id)?.paymentState).toBe("paid");
    expect(state.activeOrders.map((item) => item.id)).toEqual([order.id]);

    // The verified payment closes the checkout: the next one gets a new key.
    await state.placeOrder(SampleData.bagRoti, 1, "QRIS");
    expect(backend.keys[1]).not.toBe("checkout-test-1");
  });

  it("an unpaid checkout keeps its key, even across a reload", async () => {
    const backend = useBackend(new VerifiedPaymentBackend());
    state.restoreLocalState();
    await state.placeOrder(SampleData.bagRoti, 1, "QRIS");
    await state.placeOrder(SampleData.bagRoti, 1, "QRIS");

    const reloaded = new AppState();
    reloaded.restoreLocalState();
    await reloaded.placeOrder(SampleData.bagRoti, 1, "QRIS");

    expect(new Set(backend.keys).size).toBe(1);
    // A different quantity or method is a different checkout.
    await reloaded.placeOrder(SampleData.bagRoti, 2, "QRIS");
    expect(new Set(backend.keys).size).toBe(2);
    await reloaded.clearSessionState({ notify: false });
  });

  it("respons checkout hilang dipulihkan dari order committed", async () => {
    const backend = useBackend(new CommitThenLoseResponseBackend());

    const error = await backendError(state.placeOrder(SampleData.bagRoti, 1, "QRIS"));
    expect(error.code).toBe("response_lost");
    const recovered = await state.recoverCheckout(SampleData.bagRoti, 1, "QRIS");

    expect(backend.keys).toHaveLength(1);
    expect(recovered?.id).toBe(backend.committedOrderId);
    const committed = (await backend.activeOrders()).filter((order) => order.id === backend.committedOrderId);
    expect(committed).toHaveLength(1);
    expect(state.findOrder(backend.committedOrderId ?? "")).not.toBeNull();
    // The sample order with the same signature (no createdAt) is older.
    expect(recovered?.id).not.toBe("order-1");
  });

  it("recovery only accepts the same signature and a payment that can continue", async () => {
    class RecoveryBackend extends FakeBackend {
      override readonly isRemote = true;
      override async activeOrders(): Promise<OrderRecord[]> {
        return [
          pendingOrder(SampleData.bagKopi, 1, "QRIS", { id: "other-bag" }),
          pendingOrder(SampleData.bagRoti, 2, "QRIS", { id: "other-quantity" }),
          pendingOrder(SampleData.bagRoti, 1, "GoPay", { id: "other-method" }),
          pendingOrder(SampleData.bagRoti, 1, "QRIS", { id: "failed", paymentState: "failed" }),
          pendingOrder(SampleData.bagRoti, 1, "QRIS", { id: "older", createdAt: new Date(2026, 0, 1) }),
          pendingOrder(SampleData.bagRoti, 1, "QRIS", { id: "newer", createdAt: new Date(2026, 0, 2) }),
        ];
      }
    }
    useBackend(new RecoveryBackend());
    expect((await state.recoverCheckout(SampleData.bagRoti, 1, "QRIS"))?.id).toBe("newer");
    expect(await state.recoverCheckout(SampleData.bagSalad, 1, "QRIS")).toBeNull();
  });

  it("QRIS yang belum tersimpan dapat dibuat ulang secara idempoten", async () => {
    const backend = useBackend(new RetryQrisBackend());

    const first = await state.placeOrder(SampleData.bagRoti, 1, "QRIS", { idempotencyKey: "retry-qris-same-key" });
    expect(backend.createCalls).toBe(1);
    expect(first.paymentQrUrl).toBeNull();

    const retry = await state.placeOrder(SampleData.bagRoti, 1, "QRIS", { idempotencyKey: "retry-qris-same-key" });
    expect(backend.createCalls).toBe(2);
    expect(backend.keys.every((key) => key === "retry-qris-same-key")).toBe(true);
    expect(retry.paymentQrUrl).toBe(QR_URL);
    expect(state.activeOrders.filter((order) => order.id === "retry-qris-order")).toHaveLength(1);
  });

  it("the sandbox simulator URL comes from the status refresh", async () => {
    const backend = useBackend(new SandboxSimulatorBackend());
    const order = pendingOrder(SampleData.bagRoti, 1, "QRIS", { id: "order-fetch-simulator-url" });

    const refreshed = await state.refreshPayment(order);

    expect(backend.statusCalls).toBe(1);
    expect(refreshed.simulatorQrImageUrl).toBe(QR_URL);
    expect(state.findOrder(order.id)?.simulatorQrImageUrl).toBe(QR_URL);
  });

  it("loading orders on the remote backend syncs at most five awaiting payments", async () => {
    class PendingListBackend extends FakeBackend {
      override readonly isRemote = true;
      readonly refreshed: string[] = [];
      override async activeOrders(): Promise<OrderRecord[]> {
        return Array.from({ length: 6 }, (_, index) =>
          pendingOrder(SampleData.bagRoti, 1, "QRIS", { id: `pending-${index}` }),
        );
      }
      override async orderHistory(): Promise<OrderRecord[]> {
        return [];
      }
      override async refreshPayment(order: OrderRecord): Promise<OrderRecord> {
        this.refreshed.push(order.id);
        if (order.id === "pending-1") throw new BackendException("payment_unreachable", "x");
        return { ...order, paymentState: order.id === "pending-0" ? "paid" : "expired" };
      }
    }
    const backend = useBackend(new PendingListBackend());

    await state.loadOrders();
    await flush();

    expect(backend.refreshed).toEqual(["pending-0", "pending-1", "pending-2", "pending-3", "pending-4"]);
    expect(state.findOrder("pending-0")?.paymentState).toBe("paid");
    expect(state.findOrder("pending-1")?.paymentState).toBe("pending");
    expect(state.orderHistory.map((order) => order.id)).toEqual(["pending-4", "pending-3", "pending-2"]);
    expect(state.ordersError).toBeNull();
  });

  it("terminal payment failures move to the history tab", async () => {
    class FailedPaymentBackend extends FakeBackend {
      override async activeOrders(): Promise<OrderRecord[]> {
        return [
          pendingOrder(SampleData.bagRoti, 1, "QRIS", { id: "expired-payment", paymentState: "expired" }),
          pendingOrder(SampleData.bagRoti, 1, "QRIS", { id: "awaiting", paymentState: "awaitingPayment" }),
        ];
      }
      override async orderHistory(): Promise<OrderRecord[]> {
        return [];
      }
    }
    useBackend(new FailedPaymentBackend());

    await state.loadOrders();

    expect(state.activeOrders.map((order) => order.id)).toEqual(["awaiting"]);
    expect(state.orderHistory.map((order) => order.id)).toEqual(["expired-payment"]);
  });
});
