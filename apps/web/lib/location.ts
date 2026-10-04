"use client";

/**
 * Browser geolocation, standing in for `geolocator` on Flutter web, plus the
 * web branch of `LocationPermissionSupport`. Browsers offer no API to open a
 * site's permission settings, so the app always shows guidance instead.
 */

export const BROWSER_GUIDANCE =
  "Izinkan lokasi untuk situs SaveBite melalui ikon izin di bilah alamat browser, lalu muat ulang halaman dan coba lagi.";

export const LocationPermissionSupport = {
  browserGuidance: BROWSER_GUIDANCE,
  usesBrowserSettings: true,
  settingsActionLabel: (_options: { locationServicesEnabled: boolean }) => "Cara mengizinkan lokasi",
  permissionBlockedMessage: () => BROWSER_GUIDANCE,
  locationServicesDisabledMessage: () => BROWSER_GUIDANCE,
  /** Always `false` on the web: there is no settings page to open. */
  openSettings: async (_options: { locationServicesEnabled: boolean }) => false,
} as const;

export type LocationPermission = "denied" | "deniedForever" | "whileInUse" | "always" | "unableToDetermine";

export type Position = { latitude: number; longitude: number; accuracy: number };

export class LocationError extends Error {
  constructor(
    readonly code: "permission_denied" | "unavailable" | "timeout" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "LocationError";
  }
}

/** `Geolocator.isLocationServiceEnabled()` on web: the API exists. */
export function isLocationServiceEnabled(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * `Geolocator.checkPermission()` on web: Permissions API state, where
 * `prompt` reads as `denied` (still requestable) and `denied` is permanent.
 */
export async function checkPermission(): Promise<LocationPermission> {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (status.state === "granted") return "whileInUse";
    if (status.state === "denied") return "deniedForever";
    return "denied";
  } catch {
    // Older Safari: no Permissions API. Requesting shows the prompt.
    return "denied";
  }
}

function getPosition(options: PositionOptions): Promise<Position> {
  return new Promise<Position>((resolve, reject) => {
    if (!isLocationServiceEnabled()) {
      reject(new LocationError("unsupported", "Geolocation tidak tersedia."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) reject(new LocationError("permission_denied", error.message));
        else if (error.code === error.TIMEOUT) reject(new LocationError("timeout", error.message));
        else reject(new LocationError("unavailable", error.message));
      },
      options,
    );
  });
}

/** `Geolocator.requestPermission()` on web: triggers the browser prompt. */
export async function requestPermission(): Promise<LocationPermission> {
  try {
    await getPosition({ enableHighAccuracy: false, timeout: 20_000, maximumAge: Number.POSITIVE_INFINITY });
    return "whileInUse";
  } catch (error) {
    if (error instanceof LocationError && error.code === "permission_denied") return "deniedForever";
    // A timeout or unavailable fix still means the user granted access.
    return (await checkPermission()) === "whileInUse" ? "whileInUse" : "deniedForever";
  }
}

/** `getCurrentPosition(accuracy: bestForNavigation, timeLimit: 20s)`. */
export function getCurrentPosition(): Promise<Position> {
  return getPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
}

/** True for a usable map point (not NaN, in range, not 0,0). */
export function validCoordinates(latitude: number | null | undefined, longitude: number | null | undefined): boolean {
  return (
    latitude !== null &&
    latitude !== undefined &&
    longitude !== null &&
    longitude !== undefined &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    (latitude !== 0 || longitude !== 0)
  );
}
