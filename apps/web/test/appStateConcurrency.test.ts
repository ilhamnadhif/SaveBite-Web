/**
 * Port of `test/app_state_concurrency_test.dart`: results of older requests
 * never overwrite newer ones, and a session reset cancels running loaders.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppState } from "../lib/appState";
import { FakeBackend } from "../lib/backend/fake";
import { BackendException } from "../lib/backend/types";
import type { OrderRecord, Profile } from "../lib/models";
import { completer, flush, useBackend } from "./support/harness";

class ControlledBackend extends FakeBackend {
  readonly profileRequests: Array<ReturnType<typeof completer<Profile | null>>> = [];
  readonly activeOrderRequests: Array<ReturnType<typeof completer<OrderRecord[]>>> = [];
  readonly orderHistoryRequests: Array<ReturnType<typeof completer<OrderRecord[]>>> = [];

  override currentProfile(): Promise<Profile | null> {
    const request = completer<Profile | null>();
    this.profileRequests.push(request);
    return request.promise;
  }

  override activeOrders(): Promise<OrderRecord[]> {
    const request = completer<OrderRecord[]>();
    this.activeOrderRequests.push(request);
    return request.promise;
  }

  override orderHistory(): Promise<OrderRecord[]> {
    const request = completer<OrderRecord[]>();
    this.orderHistoryRequests.push(request);
    return request.promise;
  }
}

const profile = (id: string, name: string, email: string): Profile => ({
  id,
  name,
  email,
  phone: "",
  avatarUrl: null,
  lastMode: "consumer",
  suspendedAt: null,
  suspendedReason: null,
});

describe("app_state_concurrency_test", () => {
  let state: AppState;
  let backend: ControlledBackend;

  beforeEach(() => {
    backend = useBackend(new ControlledBackend());
    state = new AppState();
  });

  afterEach(async () => {
    await state.clearSessionState({ notify: false });
    await flush();
  });

  it("hasil loadProfile lama tidak menimpa request terbaru", async () => {
    const first = state.loadProfile();
    const second = state.loadProfile();

    backend.profileRequests[1].resolve(profile("new", "Profil Baru", "new@example.com"));
    await second;
    expect(state.userName).toBe("Profil Baru");

    backend.profileRequests[0].resolve(profile("old", "Profil Lama", "old@example.com"));
    await first;

    expect(state.userName).toBe("Profil Baru");
    expect(state.userEmail).toBe("new@example.com");
  });

  it("loadOrders lama tidak mengubah data atau loading request baru", async () => {
    const sampleOrders = await new FakeBackend().activeOrders();
    expect(sampleOrders.length).toBeGreaterThan(0);

    const first = state.loadOrders();
    const second = state.loadOrders();

    backend.activeOrderRequests[0].resolve([]);
    backend.orderHistoryRequests[0].resolve([]);
    await first;

    expect(state.isLoadingOrders).toBe(true);
    expect(state.activeOrders).toEqual([]);

    backend.activeOrderRequests[1].resolve(sampleOrders);
    backend.orderHistoryRequests[1].resolve([]);
    await second;

    expect(state.isLoadingOrders).toBe(false);
    expect(state.activeOrders).toEqual(sampleOrders);
  });

  it("error request loadOrders lama diabaikan setelah request baru sukses", async () => {
    const first = state.loadOrders();
    const second = state.loadOrders();

    backend.activeOrderRequests[1].resolve([]);
    backend.orderHistoryRequests[1].resolve([]);
    await second;

    backend.activeOrderRequests[0].reject(new BackendException("stale", "Error request lama."));
    backend.orderHistoryRequests[0].resolve([]);
    await first;

    expect(state.ordersError).toBeNull();
    expect(state.isLoadingOrders).toBe(false);
  });

  it("reset sesi membatalkan loader dan langsung mereset loading", async () => {
    const pending = state.loadOrders();
    expect(state.isLoadingOrders).toBe(true);

    // The web counterpart of Dart's test-only `resetSession()` is the real
    // session reset: its synchronous part runs before the first await.
    const reset = state.clearSessionState();
    expect(state.isLoadingOrders).toBe(false);

    backend.activeOrderRequests[0].resolve(await new FakeBackend().activeOrders());
    backend.orderHistoryRequests[0].resolve([]);
    await pending;
    await reset;

    expect(state.isLoadingOrders).toBe(false);
    expect(state.activeOrders).toEqual([]);
  });

  it("an error of a request from the previous session is not shown", async () => {
    const pending = state.loadOrders();
    await state.clearSessionState();
    backend.activeOrderRequests[0].reject(new BackendException("stale", "Sesi lama."));
    backend.orderHistoryRequests[0].resolve([]);
    await pending;
    expect(state.ordersError).toBeNull();
  });
});
