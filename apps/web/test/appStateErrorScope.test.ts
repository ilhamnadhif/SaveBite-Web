/**
 * Port of `test/app_state_error_scope_test.dart`: every tab loader keeps its
 * own error so parallel requests never show a message on the wrong screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../lib/appState";
import { FakeBackend } from "../lib/backend/fake";
import { BackendException } from "../lib/backend/types";
import type { Bag, BagFilter, OrderRecord } from "../lib/models";
import { flush, resetSession, useBackend } from "./support/harness";

class OrdersFailureBackend extends FakeBackend {
  // Throws synchronously, like the Dart override (not a rejected future).
  override activeOrders(): Promise<OrderRecord[]> {
    throw new BackendException("orders_unavailable", "Pesanan sedang tidak dapat dimuat.");
  }
}

class FavoritesFailureBackend extends FakeBackend {
  override favoriteMerchantIds(): Promise<Set<string>> {
    throw new BackendException("favorites_unavailable", "Favorit sedang tidak dapat dimuat.");
  }
}

class LocationReloadFailureBackend extends FakeBackend {
  private nearbyCalls = 0;

  override async nearbyBags(
    options: { latitude?: number | null; longitude?: number | null; filter?: BagFilter } = {},
  ): Promise<Bag[]> {
    this.nearbyCalls++;
    if (this.nearbyCalls > 1) {
      throw new BackendException("nearby_unavailable", "Bag di area ini belum dapat dimuat.");
    }
    return super.nearbyBags(options);
  }
}

describe("app_state_error_scope_test", () => {
  let appState: AppState;

  beforeEach(() => {
    appState = resetSession();
  });

  afterEach(async () => {
    await appState.clearSessionState({ notify: false });
    await flush();
  });

  it("error loader pesanan tidak bocor ke loader tab lain", async () => {
    useBackend(new OrdersFailureBackend());

    await Promise.all([
      appState.loadConsumerHome(),
      appState.loadOrders(),
      appState.loadNotifications(),
      appState.loadBalance(),
    ]);

    expect(appState.ordersError).toBe("Pesanan sedang tidak dapat dimuat.");
    expect(appState.consumerError).toBeNull();
    expect(appState.notificationsError).toBeNull();
    expect(appState.balanceError).toBeNull();
    expect(appState.errorMessage).toBeNull();
    expect(appState.isLoadingOrders).toBe(false);

    await appState.loadConsumerHome();
    expect(appState.ordersError).toBe("Pesanan sedang tidak dapat dimuat.");
  });

  it("gagal memuat favorit tidak menyembunyikan bag di beranda", async () => {
    useBackend(new FavoritesFailureBackend());

    await appState.loadConsumerHome();

    expect(appState.nearbyBags.length).toBeGreaterThan(0);
    expect(appState.consumerError).toBeNull();
  });

  it("the favourites tab still reports its own error", async () => {
    useBackend(new FavoritesFailureBackend());

    await appState.loadFavorites();

    expect(appState.favoritesError).toBe("Favorit sedang tidak dapat dimuat.");
    expect(appState.consumerError).toBeNull();
  });

  it("bag area lama dibersihkan saat area baru gagal dimuat", async () => {
    useBackend(new LocationReloadFailureBackend());

    await appState.setLocationWithCoordinates("Area pertama", -6.3725, 106.8323);
    expect(appState.nearbyBags.length).toBeGreaterThan(0);

    await appState.setLocationWithCoordinates("Area kedua", -6.2607, 106.8134);

    expect(appState.location).toBe("Area kedua");
    expect(appState.nearbyBags).toEqual([]);
    expect(appState.consumerError).toBe("Bag di area ini belum dapat dimuat.");
    expect(appState.isLoadingConsumer).toBe(false);
  });

  it("a successful retry clears the scope error", async () => {
    let failing = true;
    class FlakyOrdersBackend extends FakeBackend {
      override async activeOrders(): Promise<OrderRecord[]> {
        if (failing) throw new BackendException("orders_unavailable", "Pesanan sedang tidak dapat dimuat.");
        return super.activeOrders();
      }
    }
    useBackend(new FlakyOrdersBackend());
    await appState.loadOrders();
    expect(appState.ordersError).toBe("Pesanan sedang tidak dapat dimuat.");
    failing = false;
    await appState.loadOrders();
    expect(appState.ordersError).toBeNull();
    expect(appState.activeOrders.length).toBeGreaterThan(0);
  });

  it("non-domain errors show the generic message", async () => {
    class BrokenNotificationsBackend extends FakeBackend {
      override async notifications(): Promise<never> {
        throw new TypeError("Cannot read properties of undefined");
      }
    }
    useBackend(new BrokenNotificationsBackend());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await appState.loadNotifications();
    expect(appState.notificationsError).toBe("Terjadi kendala. Silakan coba lagi.");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
