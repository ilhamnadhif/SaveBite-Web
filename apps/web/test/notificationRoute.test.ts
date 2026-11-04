/**
 * Port of the logic parts of `test/notification_routing_test.dart` (the
 * widget tests that open screens are covered by the screen ports).
 */
import { afterEach, describe, expect, it } from "vitest";
import { AppState } from "../lib/appState";
import { FakeBackend } from "../lib/backend/fake";
import type { Unsubscribe } from "../lib/backend/types";
import { notificationFromMap, type Row } from "../lib/mappers";
import type { AppNotification, IncomingOrder, StoreProfile } from "../lib/models";
import {
  isMerchantOrdersNotificationRoute,
  parseConsumerOrderNotificationRoute,
  parseMerchantOrderNotificationRoute,
  whitelistedNotificationRoute,
} from "../lib/notificationRoute";
import { flush, useBackend } from "./support/harness";

function remoteNotification({
  id,
  title,
  dedupeKey,
  data = {},
}: {
  id: string;
  title: string;
  dedupeKey: string;
  data?: Row;
}): AppNotification {
  return notificationFromMap({
    id,
    entity_type: "order",
    title,
    body: "Uji route notifikasi",
    type: "payment",
    group_label: "Hari ini",
    read: false,
    dedupe_key: dedupeKey,
    data,
    created_at: new Date().toISOString(),
  });
}

describe("notification routes", () => {
  it("route order membedakan status aktif dan terminal", () => {
    for (const status of ["redeemed", "refunded", "cancelled", "expired", "failed", "payment-review"]) {
      const target = parseConsumerOrderNotificationRoute(`order:order-42:${status}`);
      expect(target?.orderId).toBe("order-42");
      expect(target?.preferredTab).toBe("history");
    }

    for (const status of ["paid", "ready", "pending"]) {
      expect(parseConsumerOrderNotificationRoute(`order:order-42:${status}`)?.preferredTab).toBe("active");
    }

    expect(parseConsumerOrderNotificationRoute("order:order-42")?.preferredTab).toBeNull();
    expect(parseConsumerOrderNotificationRoute("order::refunded")).toBeNull();
    expect(parseConsumerOrderNotificationRoute("merchant-order:order-42:new")).toBeNull();
  });

  it("every documented status picks the right consumer tab; unknown statuses pick none", () => {
    for (const status of ["canceled", "complete", "completed", "disputed", "done", "reviewed"]) {
      expect(parseConsumerOrderNotificationRoute(`order:o:${status}`)?.preferredTab).toBe("history");
    }
    for (const status of ["awaiting-payment", "new", "processing"]) {
      expect(parseConsumerOrderNotificationRoute(`order:o:${status}`)?.preferredTab).toBe("active");
    }
    expect(parseConsumerOrderNotificationRoute("order:o:mystery")).toEqual({ orderId: "o", preferredTab: null });
    expect(parseConsumerOrderNotificationRoute("  ORDER : o-1 : Refunded  ")).toEqual({
      orderId: "o-1",
      preferredTab: "history",
    });
    expect(parseConsumerOrderNotificationRoute("order:o:paid:extra")).toBeNull();
    expect(parseConsumerOrderNotificationRoute("order")).toBeNull();
    expect(parseConsumerOrderNotificationRoute(null)).toBeNull();
    expect(parseConsumerOrderNotificationRoute(undefined)).toBeNull();
  });

  it("route merchant dan matcher realtime mengenali new/payment-review", () => {
    const active = parseMerchantOrderNotificationRoute("merchant-order:order-42:new");
    expect(active?.orderId).toBe("order-42");
    expect(active?.preferredTab).toBe("active");

    const review = parseMerchantOrderNotificationRoute("merchant-order:order-42:payment-review");
    expect(review?.orderId).toBe("order-42");
    expect(review?.preferredTab).toBe("closed");

    expect(isMerchantOrdersNotificationRoute("merchant_orders")).toBe(true);
    expect(isMerchantOrdersNotificationRoute("merchant-order:order-42:new")).toBe(true);
    expect(isMerchantOrdersNotificationRoute("merchant-order:order-42:payment-review")).toBe(true);
    expect(isMerchantOrdersNotificationRoute("merchant-order::new")).toBe(false);
    expect(isMerchantOrdersNotificationRoute("order:order-42:paid")).toBe(false);
    expect(isMerchantOrdersNotificationRoute(" MERCHANT_ORDERS ")).toBe(true);
    expect(isMerchantOrdersNotificationRoute(null)).toBe(false);
  });

  it("mapper hanya mengambil route pesanan yang di-whitelist", () => {
    expect(
      remoteNotification({ id: "refund", title: "Pembayaran dikembalikan", dedupeKey: "order:order-4:refunded" }).route,
    ).toBe("order:order-4:refunded");
    expect(
      remoteNotification({ id: "merchant-new", title: "Pesanan baru sudah dibayar", dedupeKey: "merchant-order:order-5:new" })
        .route,
    ).toBe("merchant-order:order-5:new");
    expect(
      remoteNotification({
        id: "merchant-review",
        title: "Saldo pesanan ditahan",
        dedupeKey: "merchant-order:order-7:payment-review",
      }).route,
    ).toBe("merchant-order:order-7:payment-review");

    const fromData = notificationFromMap({
      id: "data-route",
      title: "Pembayaran dikembalikan",
      data: { route: "order:order-8:refunded" },
      dedupe_key: "arbitrary:must-not-open",
    });
    expect(fromData.route).toBe("order:order-8:refunded");

    const unsafe = notificationFromMap({
      id: "unsafe",
      title: "Tidak dikenal",
      dedupe_key: "merchant_balance:arbitrary-command",
    });
    expect(unsafe.route).toBeNull();
  });

  it("whitelist: static routes are normalised, never taken from dedupe keys", () => {
    for (const route of ["consumer_home", "home", "merchant_balance", "merchant_orders", "merchant_reviews", "orders"]) {
      expect(whitelistedNotificationRoute(route)).toBe(route);
      expect(whitelistedNotificationRoute(`  ${route.toUpperCase()} `)).toBe(route);
      expect(whitelistedNotificationRoute(route, { dynamicOrderOnly: true })).toBeNull();
    }
    expect(whitelistedNotificationRoute("")).toBeNull();
    expect(whitelistedNotificationRoute("   ")).toBeNull();
    expect(whitelistedNotificationRoute(null)).toBeNull();
    expect(whitelistedNotificationRoute("settings")).toBeNull();
    expect(whitelistedNotificationRoute("https://evil.example")).toBeNull();
  });

  it("whitelist: order routes need a safe id and a known status", () => {
    expect(whitelistedNotificationRoute("order:o-1")).toBe("order:o-1");
    expect(whitelistedNotificationRoute(" order:o-1:paid ")).toBe("order:o-1:paid");
    expect(whitelistedNotificationRoute("order:o-1:paid", { dynamicOrderOnly: true })).toBe("order:o-1:paid");
    expect(whitelistedNotificationRoute("merchant-order:o_1:payment-review")).toBe("merchant-order:o_1:payment-review");
    expect(whitelistedNotificationRoute("order:o-1:hacked")).toBeNull();
    expect(whitelistedNotificationRoute("merchant-order:o-1:drop-table")).toBeNull();
    expect(whitelistedNotificationRoute("order:o 1:paid")).toBeNull();
    expect(whitelistedNotificationRoute("order:../admin:paid")).toBeNull();
    expect(whitelistedNotificationRoute(`order:${"a".repeat(128)}:paid`)).not.toBeNull();
    expect(whitelistedNotificationRoute(`order:${"a".repeat(129)}:paid`)).toBeNull();
  });
});

/** `_RealtimeNotificationBackend`: a merchant whose notifications the test pushes. */
class RealtimeNotificationBackend extends FakeBackend {
  incomingOrdersCalls = 0;
  private push: ((values: AppNotification[]) => void) | null = null;

  override async myStore(): Promise<StoreProfile | null> {
    return {
      id: "store-route-test",
      name: "Toko Route Test",
      category: "Bakery",
      address: "Depok",
      openTime: "08.00",
      closeTime: "20.00",
      description: "",
      logoUrl: null,
      latitude: null,
      longitude: null,
      verificationStatus: "verified",
      verificationNote: null,
    };
  }

  override watchNotifications(onData: (values: AppNotification[]) => void): Unsubscribe {
    this.push = onData;
    return () => {
      this.push = null;
    };
  }

  override incomingOrders(): Promise<IncomingOrder[]> {
    this.incomingOrdersCalls++;
    return super.incomingOrders();
  }

  emit(values: AppNotification[]) {
    this.push?.(values);
  }
}

describe("realtime notification routing", () => {
  let state: AppState | null = null;

  afterEach(async () => {
    await state?.clearSessionState({ notify: false });
    state = null;
    await flush();
  });

  it("realtime merchant-order memuat ulang data merchant", async () => {
    const backend = useBackend(new RealtimeNotificationBackend());
    state = new AppState();
    await state.bootstrap();
    expect(state.merchantSetupDone).toBe(true);
    expect(backend.incomingOrdersCalls).toBe(0);

    backend.emit([
      remoteNotification({ id: "realtime-new", title: "Pesanan baru sudah dibayar", dedupeKey: "merchant-order:order-5:new" }),
    ]);
    await flush();
    expect(backend.incomingOrdersCalls).toBe(1);

    backend.emit([
      remoteNotification({ id: "realtime-new", title: "Pesanan baru sudah dibayar", dedupeKey: "merchant-order:order-5:new" }),
      remoteNotification({
        id: "realtime-review",
        title: "Saldo pesanan ditahan",
        dedupeKey: "merchant-order:order-7:payment-review",
      }),
    ]);
    await flush();
    expect(backend.incomingOrdersCalls).toBe(2);
  });

  it("an unchanged notification list does not reload merchant data again", async () => {
    const backend = useBackend(new RealtimeNotificationBackend());
    state = new AppState();
    await state.bootstrap();
    const notification = remoteNotification({
      id: "realtime-new",
      title: "Pesanan baru sudah dibayar",
      dedupeKey: "merchant-order:order-5:new",
    });

    backend.emit([notification]);
    await flush();
    backend.emit([notification]);
    await flush();
    expect(backend.incomingOrdersCalls).toBe(1);

    // A read-state change counts as a change again.
    backend.emit([{ ...notification, unread: false }]);
    await flush();
    expect(backend.incomingOrdersCalls).toBe(2);
    expect(state.unreadCount).toBe(0);
  });

  it("merchant routes are ignored before the store exists", async () => {
    class ConsumerOnlyBackend extends RealtimeNotificationBackend {
      override async myStore(): Promise<StoreProfile | null> {
        return null;
      }
    }
    const backend = useBackend(new ConsumerOnlyBackend());
    state = new AppState();
    await state.bootstrap();
    expect(state.merchantSetupDone).toBe(false);

    backend.emit([
      remoteNotification({ id: "realtime-new", title: "Pesanan baru sudah dibayar", dedupeKey: "merchant-order:order-5:new" }),
    ]);
    await flush();
    expect(backend.incomingOrdersCalls).toBe(0);
    expect(state.notifications).toHaveLength(1);
  });
});
