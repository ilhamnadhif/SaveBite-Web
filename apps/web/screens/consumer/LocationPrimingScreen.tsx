"use client";

import { useEffect, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { checkPermission, type LocationPermission } from "../../lib/location";
import { GhostButton, PrimaryButton } from "../../ui/buttons";
import { Gap, Spinner, safeBottom, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { C, display, ui } from "../../ui/theme";
import { showConsumerLocationPicker } from "./LocationPickerSheet";

function locationProblemMessage(permission: LocationPermission): string {
  if (appState.usesBrowserPermissionSettings) {
    return "Lokasi browser belum tersedia. Kamu tetap dapat memilih area secara manual untuk melanjutkan.";
  }
  if (!appState.locationServicesEnabled) {
    return "Layanan lokasi perangkat sedang nonaktif. Aktifkan lokasi, lalu coba lagi.";
  }
  if (permission === "deniedForever") {
    return "Akses lokasi diblokir. Buka pengaturan aplikasi untuk mengizinkan lokasi.";
  }
  return "SaveBite belum mendapat izin lokasi. Kamu tetap dapat memilih area secara manual dari beranda.";
}

function messageForLocationStatus(permission: LocationPermission): string {
  if (!appState.locationServicesEnabled || !appState.hasLocationPermission) {
    return locationProblemMessage(permission);
  }
  return appState.errorMessage ?? "Lokasi belum berhasil ditemukan. Coba lagi.";
}

/** True while the page is visible and focused: Flutter web's `AppLifecycleState.resumed`. */
function isResumed(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Explains why location helps before the browser permission prompt appears.
 *
 * Like the Flutter screen it is not an `appState` listener: it reads the
 * location flags when it rebuilds after its own state changes.
 */
export function LocationPrimingScreen() {
  const [busy, setBusyState] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [permission, setPermissionState] = useState<LocationPermission | null>(null);
  // `_busy` and `_permission` are fields read after awaits and by the
  // lifecycle observer, so they are mirrored in refs.
  const busyRef = useRef(false);
  const permissionRef = useRef<LocationPermission | null>(null);
  const mounted = useRef(true);

  const setBusy = (value: boolean) => {
    busyRef.current = value;
    setBusyState(value);
  };

  const setPermission = (value: LocationPermission) => {
    permissionRef.current = value;
    setPermissionState(value);
  };

  const refreshStatus = async () => {
    try {
      const located = await appState.determineLocation({ requestPermission: false });
      const current = await checkPermission();
      if (!mounted.current) return;
      if (located && appState.locationPrimed && appState.hasValidUserLocation) {
        // Permission may already be granted while the persisted priming flag
        // is being restored. Do not make the user press the permission button
        // again; continue directly to the consumer home.
        AppNav.toConsumerHome();
        return;
      }
      setPermission(current);
      setMessage(located ? null : messageForLocationStatus(current));
    } catch {
      if (!mounted.current) return;
      setMessage(messageForLocationStatus(permissionRef.current ?? "denied"));
    }
  };
  const refreshRef = useRef(refreshStatus);
  refreshRef.current = refreshStatus;

  useEffect(() => {
    mounted.current = true;
    void refreshRef.current();

    // didChangeAppLifecycleState(resumed): refresh when the page comes back.
    let resumed = isResumed();
    const onLifecycleChange = () => {
      const next = isResumed();
      if (next && !resumed && !busyRef.current) void refreshRef.current();
      resumed = next;
    };
    window.addEventListener("focus", onLifecycleChange);
    window.addEventListener("blur", onLifecycleChange);
    document.addEventListener("visibilitychange", onLifecycleChange);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onLifecycleChange);
      window.removeEventListener("blur", onLifecycleChange);
      document.removeEventListener("visibilitychange", onLifecycleChange);
    };
  }, []);

  const allow = async () => {
    if (busyRef.current) return;
    setBusy(true);
    setMessage(null);

    try {
      const located = await appState.determineLocation();
      const current = await checkPermission();
      if (!mounted.current) return;
      setPermission(current);

      if (
        located &&
        appState.locationServicesEnabled &&
        appState.hasLocationPermission &&
        appState.hasValidUserLocation
      ) {
        await appState.markLocationPrimed();
        if (!mounted.current) return;
        AppNav.toConsumerHome();
        return;
      }

      setMessage(locationProblemMessage(current));
    } catch {
      if (!mounted.current) return;
      let current: LocationPermission = permissionRef.current ?? "denied";
      try {
        current = await checkPermission();
      } catch {
        // If the location plugin cannot read the status, the user must still
        // be able to use a manual area.
      }
      if (!mounted.current) return;
      setPermission(current);
      setMessage(messageForLocationStatus(current));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const openSettings = async () => {
    if (appState.usesBrowserPermissionSettings) {
      setMessage(appState.browserLocationPermissionGuidance);
      return;
    }
    await appState.openRelevantLocationSettings();
  };

  const chooseManualArea = async () => {
    if (busyRef.current) return;
    const selected = await showConsumerLocationPicker();
    if (!mounted.current || !selected) return;
    await appState.markLocationPrimed();
    if (!mounted.current) return;
    AppNav.toConsumerHome();
  };

  const showSettings =
    !appState.usesBrowserPermissionSettings &&
    (!appState.locationServicesEnabled || permission === "deniedForever");
  const isPermissionIssue = !appState.locationServicesEnabled || !appState.hasLocationPermission;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: C.cream,
        paddingTop: safeTop(24),
        paddingRight: 24,
        paddingBottom: safeBottom(16),
        paddingLeft: 24,
      }}
    >
      <div className="sb-scroll">
        <div
          style={{
            minHeight: "56dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            role="img"
            aria-label="Ilustrasi penanda lokasi"
            style={{
              width: 120,
              height: 120,
              flex: "none",
              borderRadius: "50%",
              background: C.greenSoftBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="location_on_outlined" color={C.greenBright} size={56} />
          </div>
          <Gap h={28} />
          <h1 style={{ ...display(26), textAlign: "center" }}>Aktifkan lokasi</h1>
          <Gap h={14} />
          <p style={{ ...ui(15, { color: C.body, height: 1.55 }), textAlign: "center", maxWidth: 330 }}>
            Lokasi dipakai saat aplikasi aktif untuk mengurutkan Surprise Bag berdasarkan jarak. SaveBite tidak melacak
            perjalananmu.
          </p>
          {message !== null ? (
            <>
              <Gap h={22} />
              <div
                role="status"
                aria-live="polite"
                style={{
                  width: "100%",
                  padding: 14,
                  background: isPermissionIssue ? C.greenSoftBg : C.dangerBg,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "flex-start",
                }}
              >
                <Icon name="info_outline" size={20} color={isPermissionIssue ? C.greenAccent : C.danger} />
                <Gap w={10} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    ...ui(13, { color: isPermissionIssue ? C.greenAccent : C.danger, height: 1.45 }),
                  }}
                >
                  {message}
                </span>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {showSettings && message !== null ? (
        <>
          <GhostButton
            label={appState.locationSettingsActionLabel}
            color={C.greenBright}
            onTap={busy ? null : () => void openSettings()}
          />
          <Gap h={6} />
        </>
      ) : null}
      <PrimaryButton
        label={busy ? "Mencari lokasimu…" : "Izinkan akses lokasi"}
        icon={
          busy ? (
            <Spinner size={18} strokeWidth={2} color={C.cream} />
          ) : (
            <Icon name="my_location" size={19} color={C.cream} />
          )
        }
        onTap={busy ? null : () => void allow()}
      />
      <Gap h={6} />
      <GhostButton label="Pilih area manual" onTap={busy ? null : () => void chooseManualArea()} />
    </div>
  );
}
