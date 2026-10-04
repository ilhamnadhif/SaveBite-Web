/**
 * Port of the web branch of `test/location_permission_support_test.dart`
 * (the mobile test that opens native settings has no web counterpart), plus
 * the browser stand-in for `geolocator` and the web path of
 * `AppState.determineLocation`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppState } from "../lib/appState";
import { FakeBackend } from "../lib/backend/fake";
import {
  BROWSER_GUIDANCE,
  LocationError,
  LocationPermissionSupport,
  checkPermission,
  getCurrentPosition,
  isLocationServiceEnabled,
  requestPermission,
  validCoordinates,
} from "../lib/location";
import { flush, useBackend } from "./support/harness";

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

type GeoSuccess = (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
type GeoFailure = (error: { code: number; message: string; PERMISSION_DENIED: number; POSITION_UNAVAILABLE: number; TIMEOUT: number }) => void;

function geoError(code: number) {
  return { code, message: `error ${code}`, PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT };
}

/** Stubs `navigator.geolocation` + the Permissions API. */
function stubBrowser({
  state = "granted",
  position = { latitude: -6.201, longitude: 106.817, accuracy: 18 },
  errorCode = null,
  permissionsApi = true,
}: {
  state?: "granted" | "prompt" | "denied";
  position?: { latitude: number; longitude: number; accuracy: number };
  errorCode?: number | null;
  permissionsApi?: boolean;
} = {}) {
  const getCurrentPosition = vi.fn((success: GeoSuccess, failure: GeoFailure, _options?: PositionOptions) => {
    if (errorCode !== null) failure(geoError(errorCode));
    else success({ coords: position });
  });
  const query = vi.fn(async () => ({ state }));
  vi.stubGlobal("navigator", {
    geolocation: { getCurrentPosition },
    ...(permissionsApi ? { permissions: { query } } : {}),
  });
  return { getCurrentPosition, query };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocationPermissionSupport", () => {
  it("web memberi panduan izin situs dan tidak membuka pengaturan native", async () => {
    expect(await LocationPermissionSupport.openSettings({ locationServicesEnabled: false })).toBe(false);
    expect(await LocationPermissionSupport.openSettings({ locationServicesEnabled: true })).toBe(false);
    expect(LocationPermissionSupport.permissionBlockedMessage()).toContain("bilah alamat browser");
    expect(LocationPermissionSupport.settingsActionLabel({ locationServicesEnabled: true })).toBe("Cara mengizinkan lokasi");
  });

  it("the web branch always shows the same browser guidance", () => {
    expect(BROWSER_GUIDANCE).toBe(
      "Izinkan lokasi untuk situs SaveBite melalui ikon izin di bilah alamat browser, lalu muat ulang halaman dan coba lagi.",
    );
    expect(LocationPermissionSupport.usesBrowserSettings).toBe(true);
    expect(LocationPermissionSupport.browserGuidance).toBe(BROWSER_GUIDANCE);
    expect(LocationPermissionSupport.settingsActionLabel({ locationServicesEnabled: false })).toBe("Cara mengizinkan lokasi");
    expect(LocationPermissionSupport.locationServicesDisabledMessage()).toBe(BROWSER_GUIDANCE);
    expect(LocationPermissionSupport.permissionBlockedMessage()).toBe(BROWSER_GUIDANCE);
  });

  it("AppState exposes the same web guidance", async () => {
    const state = new AppState();
    expect(state.usesBrowserPermissionSettings).toBe(true);
    expect(state.browserLocationPermissionGuidance).toBe(BROWSER_GUIDANCE);
    expect(state.locationSettingsActionLabel).toBe("Cara mengizinkan lokasi");
    expect(await state.openRelevantLocationSettings()).toBe(false);
    expect(await state.openAppSettings()).toBe(false);
    expect(await state.openLocationSettings()).toBe(false);
  });
});

describe("browser geolocation (geolocator on the web)", () => {
  it("location services mean the Geolocation API exists", () => {
    stubBrowser();
    expect(isLocationServiceEnabled()).toBe(true);
    vi.stubGlobal("navigator", {});
    expect(isLocationServiceEnabled()).toBe(false);
  });

  it("checkPermission maps the Permissions API like geolocator_web", async () => {
    stubBrowser({ state: "granted" });
    expect(await checkPermission()).toBe("whileInUse");
    stubBrowser({ state: "prompt" });
    expect(await checkPermission()).toBe("denied");
    stubBrowser({ state: "denied" });
    expect(await checkPermission()).toBe("deniedForever");
    stubBrowser({ permissionsApi: false });
    expect(await checkPermission()).toBe("denied");
  });

  it("requestPermission prompts through a position request", async () => {
    const granted = stubBrowser({ state: "prompt" });
    expect(await requestPermission()).toBe("whileInUse");
    expect(granted.getCurrentPosition).toHaveBeenCalledTimes(1);

    stubBrowser({ errorCode: PERMISSION_DENIED });
    expect(await requestPermission()).toBe("deniedForever");

    // A timeout after the user allowed access still counts as granted.
    stubBrowser({ errorCode: TIMEOUT, state: "granted" });
    expect(await requestPermission()).toBe("whileInUse");
    stubBrowser({ errorCode: POSITION_UNAVAILABLE, state: "prompt" });
    expect(await requestPermission()).toBe("deniedForever");
  });

  it("getCurrentPosition asks for a fresh high-accuracy fix and maps errors", async () => {
    const browser = stubBrowser();
    expect(await getCurrentPosition()).toEqual({ latitude: -6.201, longitude: 106.817, accuracy: 18 });
    expect(browser.getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });

    for (const [code, expected] of [
      [PERMISSION_DENIED, "permission_denied"],
      [TIMEOUT, "timeout"],
      [POSITION_UNAVAILABLE, "unavailable"],
    ] as const) {
      stubBrowser({ errorCode: code });
      const error = await getCurrentPosition().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LocationError);
      expect((error as LocationError).code).toBe(expected);
    }

    vi.stubGlobal("navigator", {});
    const unsupported = await getCurrentPosition().catch((caught: unknown) => caught);
    expect((unsupported as LocationError).code).toBe("unsupported");
  });

  it("validCoordinates rejects NaN, out-of-range, and the 0,0 null island", () => {
    expect(validCoordinates(-6.3725, 106.8323)).toBe(true);
    expect(validCoordinates(90, 180)).toBe(true);
    expect(validCoordinates(0, 1)).toBe(true);
    for (const [latitude, longitude] of [
      [0, 0],
      [91, 0],
      [0, -181],
      [Number.NaN, 1],
      [1, Number.POSITIVE_INFINITY],
      [null, 1],
      [1, undefined],
    ] as const) {
      expect(validCoordinates(latitude, longitude)).toBe(false);
    }
  });
});

class RemoteFakeBackend extends FakeBackend {
  override readonly isRemote = true;
}

describe("AppState.determineLocation on the web", () => {
  it("uses the device point and loads nearby bags", async () => {
    useBackend(new RemoteFakeBackend());
    stubBrowser({ state: "granted" });
    const state = new AppState();

    expect(await state.determineLocation()).toBe(true);
    expect(state.location).toBe("Sekitar saya");
    expect([state.userLatitude, state.userLongitude]).toEqual([-6.201, 106.817]);
    expect(state.userLocationIsFromDevice).toBe(true);
    expect([state.deviceLatitude, state.deviceLongitude]).toEqual([-6.201, 106.817]);
    expect(state.userLocationAccuracyMeters).toBe(18);
    expect(state.userLocationAccuracyReduced).toBe(false);
    expect(state.hasLocationPermission).toBe(true);
    expect(state.locationPrimed).toBe(true);
    expect(state.nearbyBags.length).toBeGreaterThan(0);
    expect(state.errorMessage).toBeNull();
    expect(state.isDeterminingLocation).toBe(false);
  });

  it("a blocked permission shows the browser guidance", async () => {
    useBackend(new RemoteFakeBackend());
    const browser = stubBrowser({ state: "denied" });
    const state = new AppState();

    expect(await state.determineLocation()).toBe(false);
    expect(state.hasLocationPermission).toBe(false);
    expect(state.locationPermissionDeniedForever).toBe(true);
    expect(state.errorMessage).toBe(BROWSER_GUIDANCE);
    expect(browser.getCurrentPosition).not.toHaveBeenCalled();
    expect(state.isDeterminingLocation).toBe(false);
  });

  it("without requestPermission a promptable permission is not requested", async () => {
    useBackend(new RemoteFakeBackend());
    const browser = stubBrowser({ state: "prompt" });
    const state = new AppState();

    expect(await state.determineLocation({ requestPermission: false })).toBe(false);
    expect(state.locationPermissionDeniedForever).toBe(false);
    expect(state.errorMessage).toBe(BROWSER_GUIDANCE);
    expect(browser.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("no Geolocation API means location services are off", async () => {
    useBackend(new RemoteFakeBackend());
    vi.stubGlobal("navigator", {});
    const state = new AppState();

    expect(await state.determineLocation()).toBe(false);
    expect(state.locationServicesEnabled).toBe(false);
    expect(state.errorMessage).toBe(BROWSER_GUIDANCE);
  });

  it("an invalid fix or a timeout keeps the previous point", async () => {
    useBackend(new RemoteFakeBackend());
    stubBrowser({ state: "granted", position: { latitude: 0, longitude: 0, accuracy: 5 } });
    const state = new AppState();

    expect(await state.determineLocation()).toBe(false);
    expect(state.errorMessage).toBe("Perangkat mengembalikan titik lokasi yang tidak valid.");
    expect(state.userLatitude).toBeNull();

    stubBrowser({ state: "granted", errorCode: TIMEOUT });
    expect(await state.determineLocation()).toBe(false);
    expect(state.errorMessage).toBe("Lokasi tidak dapat dibaca. Coba lagi.");
    expect(state.locationPrimed).toBe(false);
  });

  it("the store point never changes the consumer search area", async () => {
    useBackend(new RemoteFakeBackend());
    stubBrowser({ state: "granted", position: { latitude: -6.372, longitude: 106.8318, accuracy: 7 } });
    const state = new AppState();
    state.userLatitude = -6.2607;
    state.userLongitude = 106.8134;

    expect(await state.determineStoreLocation()).toEqual({ latitude: -6.372, longitude: 106.8318, accuracy: 7 });
    expect([state.userLatitude, state.userLongitude]).toEqual([-6.2607, 106.8134]);

    stubBrowser({ state: "granted", position: { latitude: 0, longitude: 0, accuracy: 7 } });
    expect(await state.determineStoreLocation()).toBeNull();
    expect(state.errorMessage).toBe("Perangkat mengembalikan titik toko yang tidak valid.");

    stubBrowser({ state: "granted", errorCode: POSITION_UNAVAILABLE });
    expect(await state.determineStoreLocation()).toBeNull();
    expect(state.errorMessage).toBe("Lokasi toko tidak dapat dibaca. Coba lagi.");
    await flush();
  });
});
