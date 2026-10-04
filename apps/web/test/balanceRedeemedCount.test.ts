/**
 * Port of `test/balance_redeemed_count_test.dart`.
 */
import { afterEach, expect, it } from "vitest";
import { AppState } from "../lib/appState";
import { FakeBackend } from "../lib/backend/fake";
import { incomingOrderFromMap } from "../lib/mappers";
import { incomingOrder, type IncomingOrder } from "../lib/models";
import { flush, useBackend } from "./support/harness";

class MixedCompletedOrdersBackend extends FakeBackend {
  override async incomingOrders(): Promise<IncomingOrder[]> {
    return [
      incomingOrder({
        id: "redeemed-order",
        customer: "Redeemed",
        initial: "R",
        time: "Hari ini",
        bags: 1,
        code: "SB-REDEEMED",
        status: "redeemed",
      }),
      incomingOrder({
        id: "cancelled-order",
        customer: "Cancelled",
        initial: "C",
        time: "Hari ini",
        bags: 2,
        code: "SB-CANCELLED",
        status: "cancelled",
      }),
      incomingOrderFromMap({ id: "refunded-order", consumer_name: "Refunded", status: "refunded", quantity: 3 }),
    ];
  }
}

afterEach(async () => {
  await flush();
});

it("statistik bag hanya menghitung order redeemed", async () => {
  useBackend(new MixedCompletedOrdersBackend());
  const state = new AppState();

  await state.loadMerchantData();

  expect(state.completedOrders).toHaveLength(3);
  expect(state.redeemedBagCount).toBe(1);
  expect(state.pendingOrders).toHaveLength(0);
  expect(state.pendingOrderCount).toBe(0);
});
