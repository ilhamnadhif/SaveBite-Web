/**
 * Shared test helpers for the ports of the Flutter logic tests.
 */
import { AppState } from "../../lib/appState";
import { setBackendForTest } from "../../lib/backend";
import { FakeBackend } from "../../lib/backend/fake";
import { BackendException, type Backend } from "../../lib/backend/types";

/** Dart `await Future<void>.delayed(Duration.zero)`: lets queued microtasks and timers run. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Dart `app_backend.backend = backend`. */
export function useBackend<T extends Backend>(backend: T): T {
  setBackendForTest(backend);
  return backend;
}

/**
 * Dart's `@visibleForTesting appState.resetSession()`: a fresh FakeBackend
 * and a state with the demo identity and the Margonda search area. The web
 * `AppState` has no such helper, so each test gets a new instance.
 */
export function resetSession(): AppState {
  setBackendForTest(new FakeBackend());
  const state = new AppState();
  state.mode = "consumer";
  state.location = "Margonda, Depok";
  state.userLatitude = -6.3725;
  state.userLongitude = 106.8323;
  state.userName = "Ilham Hidayat";
  state.userEmail = "ilham@gmail.com";
  state.userPhone = "0812-3456-7890";
  state.storeName = "Roti Nyaman Bakery";
  state.storeCategory = "Bakery";
  state.storeAddress = "Jl. Margonda Raya No. 88, Depok";
  state.openTime = "08.00";
  state.closeTime = "21.00";
  state.storeDescription = "";
  state.storeLogoUrl = null;
  state.storeLatitude = -6.372;
  state.storeLongitude = 106.8318;
  return state;
}

/** Resolves with the `BackendException` a promise rejects with (fails otherwise). */
export async function backendError(promise: Promise<unknown>): Promise<BackendException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BackendException) return error;
    throw new Error(`Expected a BackendException, got ${String(error)}`);
  }
  throw new Error("Expected a BackendException, but the promise resolved");
}

/** A promise the test completes by hand (Dart's `Completer`). */
export function completer<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
