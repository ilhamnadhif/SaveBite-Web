"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { appState } from "../../lib/appState";
import { TextButton } from "../../ui/buttons";
import { AppCard, ErrorBox, Gap, SheetHandle, Spinner } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { showSheet } from "../../ui/overlays";
import { C, R, SHEET_BARRIER, display, ui } from "../../ui/theme";

type LocationPreset = { readonly label: string; readonly latitude: number; readonly longitude: number };

const PRESETS: readonly LocationPreset[] = [
  { label: "Margonda, Depok", latitude: -6.3721, longitude: 106.8325 },
  { label: "Cibinong, Bogor", latitude: -6.484, longitude: 106.8424 },
  { label: "Kemang, Jakarta", latitude: -6.2607, longitude: 106.8133 },
];

/**
 * Shared area picker for the home screen and location onboarding
 * (`ConsumerLocationPicker.show`).
 *
 * Choosing an area manually does not depend on GPS permission, so discovery
 * keeps working when the browser or device denies location access instead of
 * stranding the user on the permission screen.
 *
 * Resolves `true` once a location has been applied and its bags have loaded.
 */
export async function showConsumerLocationPicker(): Promise<boolean> {
  const selected = await showSheet<boolean>((close) => <ConsumerLocationPickerSheet close={close} />, {
    barrierColor: SHEET_BARRIER,
    label: "Pilih area",
  });
  return selected ?? false;
}

/** The sheet body of {@link showConsumerLocationPicker}; `close(true)` pops with success. */
export function ConsumerLocationPickerSheet({ close }: { close: (selected?: boolean) => void }) {
  const [busy, setBusyState] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [offerPermissionHelp, setOfferPermissionHelp] = useState(false);
  // `busy` is read by the async handlers after awaits, like the Dart local.
  const busyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setBusy = (value: boolean) => {
    busyRef.current = value;
    setBusyState(value);
  };

  const locateCurrentPosition = async () => {
    if (busyRef.current) return;
    setBusy(true);
    setLocalError(null);
    setOfferPermissionHelp(false);
    let error: string | null;
    let help = false;
    try {
      const located = await appState.determineLocation();
      if (!located) {
        help = !appState.locationServicesEnabled || !appState.hasLocationPermission;
        error = appState.errorMessage ?? "Lokasi terbaru belum berhasil ditemukan.";
      } else if (!appState.locationServicesEnabled) {
        help = true;
        error = "Layanan lokasi perangkat belum aktif.";
      } else if (!appState.hasLocationPermission) {
        help = true;
        error = appState.usesBrowserPermissionSettings
          ? appState.browserLocationPermissionGuidance
          : appState.locationPermissionDeniedForever
            ? "Izin lokasi diblokir. Buka pengaturan aplikasi untuk mengaktifkannya."
            : "Izin lokasi belum diberikan.";
      } else if (!appState.hasValidUserLocation) {
        error = appState.errorMessage ?? "Lokasi belum berhasil ditemukan. Coba lagi.";
      } else if (appState.consumerError !== null) {
        error = appState.consumerError;
      } else {
        if (!mounted.current) return;
        close(true);
        return;
      }
    } catch {
      help = !appState.locationServicesEnabled || !appState.hasLocationPermission;
      error = appState.errorMessage ?? "Lokasi gagal diperbarui. Periksa izin dan koneksimu.";
    }
    if (!mounted.current) return;
    setOfferPermissionHelp(help);
    setLocalError(error);
    setBusy(false);
  };

  const selectPreset = async (preset: LocationPreset) => {
    if (busyRef.current) return;
    setBusy(true);
    setLocalError(null);
    setOfferPermissionHelp(false);
    try {
      await appState.setLocationWithCoordinates(preset.label, preset.latitude, preset.longitude);
      if (!mounted.current) return;
      if (appState.consumerError !== null) {
        setBusy(false);
        setLocalError(appState.consumerError);
        return;
      }
      close(true);
    } catch {
      if (!mounted.current) return;
      setBusy(false);
      setLocalError(appState.consumerError ?? "Area gagal dimuat. Periksa koneksimu lalu coba lagi.");
    }
  };

  const openSettings = async () => {
    if (appState.usesBrowserPermissionSettings) {
      setLocalError(appState.browserLocationPermissionGuidance);
      return;
    }
    const opened = await appState.openRelevantLocationSettings();
    if (!opened && mounted.current) {
      setLocalError("Pengaturan tidak dapat dibuka otomatis. Buka pengaturan perangkat dan izinkan lokasi untuk SaveBite.");
    }
  };

  return (
    // SafeArea(top: false) around the sheet.
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, paddingBottom: "var(--safe-bottom)" }}>
      <div
        className="sb-scroll"
        style={{
          maxHeight: "82dvh",
          background: C.cream,
          borderTopLeftRadius: R.sheet,
          borderTopRightRadius: R.sheet,
          padding: "14px 20px 24px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          <SheetHandle />
        </div>
        <h2 style={display(22, { weight: 800 })}>Pilih area</h2>
        <Gap h={6} />
        <p style={ui(13.5, { color: C.body })}>Gunakan posisi saat ini atau pilih area secara manual.</p>
        <Gap h={18} />
        <AppCard padding={0} onTap={busy ? undefined : () => void locateCurrentPosition()}>
          <ListTileRow
            leading={
              busy ? (
                <Spinner size={24} strokeWidth={2.2} color={C.greenBright} />
              ) : (
                <Icon name="my_location" color={C.greenBright} />
              )
            }
            title={<span style={ui(14.5, { weight: 700 })}>{busy ? "Mencari lokasimu…" : "Lokasi saat ini"}</span>}
            subtitle={<span style={ui(12, { color: C.body })}>Menggunakan GPS perangkat</span>}
            trailing={<Icon name="chevron_right" color={C.chevron} />}
          />
        </AppCard>
        {localError !== null ? (
          <>
            <Gap h={10} />
            <ErrorBox>
              <div>{localError}</div>
              {offerPermissionHelp && !appState.usesBrowserPermissionSettings ? (
                <>
                  <Gap h={4} />
                  <TextButton label={appState.locationSettingsActionLabel} onTap={() => void openSettings()} />
                </>
              ) : null}
            </ErrorBox>
          </>
        ) : null}
        <Gap h={22} />
        <div style={ui(13, { weight: 700, color: C.body })}>Area pilihan</div>
        <Gap h={8} />
        <AppCard padding={0} style={{ overflow: "hidden" }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="sb-ink"
              disabled={busy}
              onClick={busy ? undefined : () => void selectPreset(preset)}
              style={{ display: "block", width: "100%", textAlign: "left" }}
            >
              <ListTileRow
                leading={<Icon name="location_on_outlined" color={C.body} />}
                title={<span style={ui(14, { weight: 600 })}>{preset.label}</span>}
                trailing={
                  appState.location === preset.label ? <Icon name="check_circle" color={C.greenBright} /> : null
                }
              />
            </button>
          ))}
        </AppCard>
      </div>
    </div>
  );
}

/**
 * Material 3 `ListTile` layout: content padding 16/24, 24px minimum leading
 * width, 16px title gap, and a 56px (one line) or 72px (two lines) height.
 */
function ListTileRow({
  leading,
  title,
  subtitle,
  trailing,
}: {
  leading: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        minHeight: subtitle ? 72 : 56,
        padding: "8px 24px 8px 16px",
      }}
    >
      <span style={{ minWidth: 24, flex: "none", display: "flex", alignItems: "center" }}>{leading}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {title}
        {subtitle ?? null}
      </span>
      {trailing ? <span style={{ flex: "none", display: "flex" }}>{trailing}</span> : null}
    </span>
  );
}
