"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { FieldLabel, Gap, Spinner } from "../../ui/common";
import { Icon, type IconName } from "../../ui/Icon";
import { C, ui, withAlpha } from "../../ui/theme";
import { MerchantFormField } from "./MerchantFormFields";
import type { StoreLocationMapProps, StoreMapController } from "./StoreLocationMap";

/* ------------------------------------------------------------------------- *
 * The parts of `services/store_geocoding_service.dart` the web uses. There is
 * no geocoding on the web (`manualSelectionOnly`), only the point and its
 * validation.
 * ------------------------------------------------------------------------- */

/** `StoreGeoPoint`. */
export type StoreGeoPoint = { readonly latitude: number; readonly longitude: number };

/** `isValidStoreCoordinate`. */
export function isValidStoreCoordinate(latitude: number | null | undefined, longitude: number | null | undefined): boolean {
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

/** `StoreGeoPoint.isValid`. */
export function isValidStorePoint(point: StoreGeoPoint): boolean {
  return isValidStoreCoordinate(point.latitude, point.longitude);
}

/** `StoreLocationInputException`: a message that is safe to show on the form. */
export class StoreLocationInputException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreLocationInputException";
  }
}

/** `StoreCurrentLocation`. */
export type StoreCurrentLocation = { readonly point: StoreGeoPoint; readonly accuracyMeters: number | null };

/** `StoreCurrentLocationReader`. */
export type StoreCurrentLocationReader = () => Promise<StoreCurrentLocation | null>;

/* ------------------------------------------------------------------------- */

/** Rendered when the map chunk cannot load: the empty map background, like tiles that fail. */
const MapUnavailable: ComponentType<StoreLocationMapProps> = () => null;

// Leaflet needs `window` at import time, so the map is a client-only chunk.
const StoreLocationMap = dynamic<StoreLocationMapProps>(
  () =>
    import("./StoreLocationMap")
      .then((loaded) => loaded.StoreLocationMap)
      .catch(() => MapUnavailable),
  { ssr: false, loading: () => null },
);

const FALLBACK_CENTER: StoreGeoPoint = { latitude: -6.3725, longitude: 106.8323 };
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";

const STATUS_SYNCED = "Alamat dan titik peta sudah sinkron.";
const STATUS_ADDRESS_READY = "Alamat siap. Ketuk lokasi toko yang tepat di peta.";

/** Material `elevation: 3`. */
const ELEVATION_3 = "0 3px 3px -2px rgba(0, 0, 0, 0.2), 0 3px 4px 0 rgba(0, 0, 0, 0.14), 0 1px 8px 0 rgba(0, 0, 0, 0.12)";

type ViewState = {
  point: StoreGeoPoint | null;
  busy: boolean;
  synchronized: boolean;
  statusIsError: boolean;
  status: string;
};

/**
 * Address input and map that keep the store's address and coordinates paired
 * (`StoreLocationSection`). On the web the merchant types the full address and
 * then picks the point manually, on the map or from the current location,
 * because native geocoding is not available (`manualSelectionOnly = kIsWeb`).
 */
export function StoreLocationSection({
  address,
  onAddressChange,
  initialLatitude,
  initialLongitude,
  onPointChanged,
  onBusyChanged,
  readCurrentLocation,
  error,
  enabled = true,
  inputId,
}: {
  /** `addressController.text`. */
  address: string;
  /** The user edited the address (the controller's new text). */
  onAddressChange: (value: string) => void;
  initialLatitude: number | null;
  initialLongitude: number | null;
  onPointChanged: (point: StoreGeoPoint | null) => void;
  onBusyChanged: (busy: boolean) => void;
  readCurrentLocation: StoreCurrentLocationReader;
  /** The address validator's message, shown once the form validates. */
  error?: string | null;
  enabled?: boolean;
  /** Id of the address input (lets the previous field move focus here). */
  inputId?: string;
}) {
  const generatedId = useId();
  const fieldId = inputId ?? generatedId;
  const [view, setView] = useState<ViewState>(() => initialView(address, initialLatitude, initialLongitude));
  const viewRef = useRef(view);
  const cameraCenter = useRef<StoreGeoPoint>(view.point ?? FALLBACK_CENTER);
  const mapController = useRef<StoreMapController | null>(null);
  const requestGeneration = useRef(0);
  const alive = useRef(true);
  const latest = useRef({ address, enabled, onPointChanged, onBusyChanged, readCurrentLocation });
  latest.current = { address, enabled, onPointChanged, onBusyChanged, readCurrentLocation };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  const update = useCallback((patch: Partial<ViewState>) => {
    viewRef.current = { ...viewRef.current, ...patch };
    setView(viewRef.current);
  }, []);

  const moveMap = useCallback((point: StoreGeoPoint, zoom: number) => {
    cameraCenter.current = point;
    mapController.current?.move(point, Math.min(19, Math.max(4, zoom)));
  }, []);

  // didUpdateWidget: the parent passed different coordinates.
  const previousInitial = useRef({ latitude: initialLatitude, longitude: initialLongitude });
  useLayoutEffect(() => {
    const previous = previousInitial.current;
    if (previous.latitude === initialLatitude && previous.longitude === initialLongitude) return;
    previousInitial.current = { latitude: initialLatitude, longitude: initialLongitude };
    if (viewRef.current.busy) return;
    const incoming = validPoint(initialLatitude, initialLongitude);
    const current = viewRef.current.point;
    if (incoming?.latitude === current?.latitude && incoming?.longitude === current?.longitude) return;
    if (incoming === null) {
      update({ point: null, synchronized: false });
      return;
    }
    update({
      point: incoming,
      synchronized: latest.current.address.trim().length >= 8,
      status: STATUS_SYNCED,
      statusIsError: false,
    });
    moveMap(incoming, 17);
  }, [initialLatitude, initialLongitude, update, moveMap]);

  const setBusy = (value: boolean) => {
    if (viewRef.current.busy === value || !alive.current) return;
    update({ busy: value });
    latest.current.onBusyChanged(value);
  };

  const finishWithError = (message: string) => {
    latest.current.onPointChanged(null);
    update({ synchronized: false, statusIsError: true, status: message });
    setBusy(false);
  };

  const acceptManualPoint = (point: StoreGeoPoint, successMessage: string) => {
    if (!alive.current) return;
    requestGeneration.current += 1;
    latest.current.onPointChanged(null);
    const hasCompleteAddress = latest.current.address.trim().length >= 8;
    update({
      point,
      synchronized: hasCompleteAddress,
      statusIsError: !hasCompleteAddress,
      status: hasCompleteAddress
        ? successMessage
        : "Ketik alamat lengkap minimal 8 karakter, lalu pilih kembali titik toko di peta.",
    });
    moveMap(point, 17);
    if (hasCompleteAddress) latest.current.onPointChanged(point);
    setBusy(false);
  };

  const onAddressChanged = (value: string) => {
    latest.current = { ...latest.current, address: value };
    onAddressChange(value);
    requestGeneration.current += 1;
    latest.current.onPointChanged(null);
    const searchable = value.trim().length >= 8;
    update({
      point: null,
      synchronized: false,
      statusIsError: false,
      status: searchable ? STATUS_ADDRESS_READY : "Lengkapi alamat, lalu pilih titik toko di peta.",
    });
    setBusy(false);
  };

  const fillFromCurrentLocation = async () => {
    if (!latest.current.enabled) return;
    unfocus();
    requestGeneration.current += 1;
    const request = requestGeneration.current;
    latest.current.onPointChanged(null);
    update({ point: null, synchronized: false, statusIsError: false, status: "Membaca lokasi toko…" });
    setBusy(true);
    try {
      const current = await latest.current.readCurrentLocation();
      if (!alive.current || request !== requestGeneration.current) return;
      if (current === null || !isValidStorePoint(current.point)) {
        finishWithError("Lokasi toko belum berhasil dibaca. Coba lagi.");
        return;
      }
      acceptManualPoint(
        current.point,
        current.accuracyMeters === null
          ? "Titik toko diisi dari lokasi saat ini."
          : `Titik toko diisi dari lokasi saat ini (±${dartRound(current.accuracyMeters)} m).`,
      );
    } catch (failure) {
      if (!alive.current || request !== requestGeneration.current) return;
      finishWithError(messageFor(failure));
    }
  };

  const selectMapPoint = (point: StoreGeoPoint) => {
    if (!latest.current.enabled) return;
    unfocus();
    if (!isValidStorePoint(point)) return;
    acceptManualPoint(point, "Alamat dan titik peta sudah sinkron. Pastikan pin tepat di toko.");
  };

  const { point, busy, synchronized, statusIsError, status } = view;
  return (
    <div>
      <FieldLabel htmlFor={fieldId}>Alamat</FieldLabel>
      <MerchantFormField
        id={fieldId}
        value={address}
        onChange={onAddressChanged}
        error={error}
        hintText="Jalan, nomor, kelurahan, kota"
        autoCapitalize="sentences"
        enterKeyHint="done"
        enabled={enabled}
        borderColor={statusIsError ? C.danger : synchronized ? C.greenSoftBorder : C.inputBorder}
        trailing={
          busy ? (
            <Spinner size={18} strokeWidth={2} />
          ) : (
            <Icon
              name={synchronized ? "check_circle_outline" : "location_searching_outlined"}
              size={19}
              color={synchronized ? C.greenAccent : C.muted}
            />
          )
        }
        inputProps={{ autoComplete: "off", onKeyDown: blurOnEnter }}
      />
      <Gap h={10} />
      <div
        style={{
          position: "relative",
          height: 228,
          borderRadius: 18,
          border: `1.5px solid ${statusIsError ? C.danger : C.inputBorder}`,
          overflow: "hidden",
          background: C.mapGridBg,
          isolation: "isolate",
        }}
      >
        {/* IgnorePointer(ignoring: !enabled) */}
        <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: enabled ? undefined : "none" }}>
          <StoreLocationMap
            initialCenter={cameraCenter.current}
            initialZoom={point === null ? 13 : 17}
            point={point}
            synchronized={synchronized}
            onTap={selectMapPoint}
            onReady={(controller) => {
              mapController.current = controller;
            }}
          />
        </div>
        <MapHint synchronized={synchronized} />
        <CurrentLocationButton busy={busy} enabled={enabled && !busy} onTap={() => void fillFromCurrentLocation()} />
        <a
          href={OSM_COPYRIGHT}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: "absolute",
            left: 7,
            bottom: 6,
            zIndex: 1,
            padding: "3px 5px",
            background: withAlpha(C.white, 0.88),
            ...ui(9.5, { color: C.body }),
          }}
        >
          © OpenStreetMap
        </a>
      </div>
      <Gap h={8} />
      <StatusLine busy={busy} statusIsError={statusIsError} synchronized={synchronized} status={status} />
    </div>
  );
}

function initialView(address: string, latitude: number | null, longitude: number | null): ViewState {
  const point = validPoint(latitude, longitude);
  const completeAddress = address.trim().length >= 8;
  const synchronized = point !== null && completeAddress;
  return {
    point,
    busy: false,
    synchronized,
    statusIsError: false,
    status: synchronized
      ? STATUS_SYNCED
      : completeAddress
        ? STATUS_ADDRESS_READY
        : "Ketik alamat lengkap, lalu ketuk titik toko di peta.",
  };
}

function validPoint(latitude: number | null, longitude: number | null): StoreGeoPoint | null {
  return latitude !== null && longitude !== null && isValidStoreCoordinate(latitude, longitude) ? { latitude, longitude } : null;
}

function messageFor(error: unknown): string {
  return error instanceof StoreLocationInputException
    ? error.message
    : "Lokasi belum dapat disinkronkan. Periksa koneksi lalu coba lagi.";
}

/** Dart `double.round()`: half away from zero; throws for NaN and infinity. */
function dartRound(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`Cannot round ${value}`);
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** `FocusScope.of(context).unfocus()`. */
function unfocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/** `TextInputAction.done`: the keyboard action closes the keyboard. */
function blurOnEnter(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.blur();
}

function StatusLine({
  busy,
  statusIsError,
  synchronized,
  status,
}: {
  busy: boolean;
  statusIsError: boolean;
  synchronized: boolean;
  status: string;
}) {
  const icon: IconName = busy
    ? "sync"
    : statusIsError
      ? "error_outline"
      : synchronized
        ? "check_circle_outline"
        : "info_outline";
  const color = statusIsError ? C.danger : synchronized ? C.greenAccent : C.muted;
  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      <span style={{ paddingTop: 1, flex: "none" }}>
        <Icon name={icon} size={16} color={color} />
      </span>
      <Gap w={7} />
      <p role="status" style={{ ...ui(12, { color, height: 1.4 }), flex: 1, minWidth: 0 }}>
        {status}
      </p>
    </div>
  );
}

function MapHint({ synchronized }: { synchronized: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        zIndex: 1,
        maxWidth: 235,
        padding: "6px 9px",
        background: withAlpha(C.white, 0.94),
        borderRadius: 10,
        boxShadow: "0 0 5px rgba(0, 0, 0, 0.102)",
        display: "flex",
        alignItems: "center",
      }}
    >
      <Icon
        name={synchronized ? "check_circle_outline" : "touch_app_outlined"}
        size={15}
        color={synchronized ? C.greenAccent : C.terracotta}
      />
      <Gap w={6} />
      <span style={{ ...ui(11, { weight: 700, color: C.ink }), minWidth: 0 }}>
        {synchronized ? "Alamat dan pin sinkron" : "Ketuk peta untuk memilih titik"}
      </span>
    </div>
  );
}

function CurrentLocationButton({ busy, enabled, onTap }: { busy: boolean; enabled: boolean; onTap: () => void }) {
  return (
    <button
      type="button"
      className="sb-ink"
      aria-label="Gunakan lokasi toko saat ini"
      disabled={!enabled}
      onClick={enabled ? onTap : undefined}
      style={{
        position: "absolute",
        right: 10,
        bottom: 10,
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "10px 11px",
        background: C.white,
        borderRadius: 12,
        boxShadow: ELEVATION_3,
      }}
    >
      {busy ? <Spinner size={18} strokeWidth={2} /> : <Icon name="my_location" size={19} color={C.terracotta} />}
      <span style={ui(11.5, { weight: 700, color: enabled ? C.ink : C.muted })}>{busy ? "Membaca…" : "Lokasi saat ini"}</span>
    </button>
  );
}
