"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { validCoordinates } from "../../lib/location";
import { formatRupiah, isFilterEmpty, type Bag } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FoodImage, PriceTag } from "../../ui/bagCards";
import { FilledButton, IconButton, TextButton } from "../../ui/buttons";
import { CountBadge, Gap, Spinner, safeTop } from "../../ui/common";
import { Icon, type IconName } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, display, ellipsis, ui, withAlpha } from "../../ui/theme";
import type { ConsumerMapCanvasProps, MapCanvasController, MapPin, MapPoint } from "./ConsumerMapCanvas";

/** The map's background while Leaflet loads (`MapOptions.backgroundColor`). */
function MapBackground() {
  return <div aria-hidden style={{ position: "absolute", inset: 0, background: C.mapGridBg }} />;
}

/** Stand-in when the map chunk cannot be fetched (e.g. offline): the rest of the tab keeps working. */
function MapCanvasUnavailable(_props: ConsumerMapCanvasProps) {
  return <MapBackground />;
}

// Leaflet touches `window` at import time, so the map is loaded client-side only.
const ConsumerMapCanvas = dynamic<ConsumerMapCanvasProps>(
  () =>
    import("./ConsumerMapCanvas").then(
      (module) => module.ConsumerMapCanvas,
      () => MapCanvasUnavailable,
    ),
  { ssr: false, loading: () => <MapBackground /> },
);

const FALLBACK_CENTER: MapPoint = { latitude: -6.3721, longitude: 106.8325 };
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";

/** A usable map point (`_validCoordinates`), or null. */
function pointOf(latitude: number | null, longitude: number | null): MapPoint | null {
  return latitude !== null && longitude !== null && validCoordinates(latitude, longitude) ? { latitude, longitude } : null;
}

const merchantPoint = (bag: Bag) => pointOf(bag.merchant.latitude, bag.merchant.longitude);

/** `_mappedBags`: available bags whose store has a map point. */
function mappedBags(nearby: readonly Bag[]): Bag[] {
  return nearby.filter((bag) => !bag.soldOut && merchantPoint(bag) !== null);
}

/** latlong2 `const Distance()`: metres, rounded. */
function distanceMeters(a: MapPoint, b: MapPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6378137 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** `_pinLabel`. */
function pinLabel(salePrice: number): string {
  return salePrice >= 1000000 ? `Rp${(salePrice / 1000000).toFixed(1)}jt` : `Rp${Math.trunc(salePrice / 1000)}rb`;
}

/**
 * `Material(elevation: e, shadowColor: black @ alpha)`: the spot shadow Flutter
 * draws (25 % of the shadow colour's alpha, offset and blur from the elevation).
 */
function elevationShadow(elevation: number, shadowAlpha = 1): string {
  return `0 ${elevation}px ${elevation * 2}px rgba(0, 0, 0, ${Number((0.25 * shadowAlpha).toFixed(3))})`;
}

/** Discovery map on OpenStreetMap with the stores' saved coordinates (consumer tab 1). */
export function MapScreen() {
  const state = useAppState();
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
  const [selectionDismissed, setSelectionDismissed] = useState(false);
  const [mapMovedByUser, setMapMovedByUser] = useState(false);
  const [locationBusy, setLocationBusyState] = useState(false);
  const [areaBusy, setAreaBusyState] = useState(false);
  const controller = useRef<MapCanvasController | null>(null);
  const mapReady = useRef(false);
  const didInitialFit = useRef(false);
  const lastSyncedCenter = useRef<MapPoint | null>(null);
  // Busy flags are read before React re-renders (double taps, effects).
  const locationBusyRef = useRef(false);
  const areaBusyRef = useRef(false);
  const alive = useRef(true);

  const setLocationBusy = (value: boolean) => {
    locationBusyRef.current = value;
    setLocationBusyState(value);
  };
  const setAreaBusy = (value: boolean) => {
    areaBusyRef.current = value;
    setAreaBusyState(value);
  };

  const bags = mappedBags(state.nearbyBags);
  const selected = selectionDismissed || selectedBagId === null ? null : (bags.find((bag) => bag.id === selectedBagId) ?? null);
  const hasDeviceLocation = state.hasLocationPermission && state.hasValidDeviceLocation;
  const deviceCenter = hasDeviceLocation ? pointOf(state.deviceLatitude, state.deviceLongitude) : null;
  const shouldOfferLocationSettings =
    !state.locationServicesEnabled ||
    state.locationPermissionDeniedForever ||
    (state.usesBrowserPermissionSettings && !state.hasLocationPermission);
  const consumerError = state.consumerError;

  const scheduleInitialFit = (fitBags: readonly Bag[]) => {
    if (!mapReady.current || appState.isLoadingConsumer) return;
    const discoveryCenter = pointOf(appState.userLatitude, appState.userLongitude);
    const lastCenter = lastSyncedCenter.current;
    const centerChanged =
      discoveryCenter !== null && (lastCenter === null || distanceMeters(lastCenter, discoveryCenter) > 2);
    if (didInitialFit.current && !centerChanged) return;
    didInitialFit.current = true;
    if (discoveryCenter) lastSyncedCenter.current = discoveryCenter;
    const map = controller.current;
    if (!alive.current || !mapReady.current || !map) return;
    if (discoveryCenter) {
      // The chosen location is the discovery centre. Do not force every far
      // away store into one frame: that makes the device position look
      // shifted / inaccurate.
      map.move(discoveryCenter, 15);
      return;
    }
    const points = fitBags.flatMap((bag) => {
      const point = merchantPoint(bag);
      return point ? [point] : [];
    });
    if (points.length === 0) {
      map.move(FALLBACK_CENTER, 14);
    } else if (points.length === 1) {
      map.move(points[0], 15);
    } else {
      map.fitPoints(points, { left: 54, top: 130, right: 54, bottom: 220 }, 15.5);
    }
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // initState: refresh the device location without prompting
  // (`_refreshDeviceLocationWithoutPrompt`).
  useEffect(() => {
    if (locationBusyRef.current) return;
    locationBusyRef.current = true;
    setLocationBusyState(true);
    void (async () => {
      try {
        const located = await appState.determineLocation({ requestPermission: false });
        if (!alive.current || !located) return;
        lastSyncedCenter.current = null;
        setMapMovedByUser(false);
      } catch {
        // A passive refresh never interrupts browsing; the location button can
        // still ask for permission or retry explicitly.
      } finally {
        if (alive.current) {
          locationBusyRef.current = false;
          setLocationBusyState(false);
        }
      }
    })();
  }, []);

  // `_scheduleInitialFit(bags)` runs on every build.
  useEffect(() => {
    scheduleInitialFit(bags);
  });

  const onMapReady = (next: MapCanvasController | null) => {
    controller.current = next;
    mapReady.current = next !== null;
    if (next) scheduleInitialFit(mappedBags(appState.nearbyBags));
  };

  const onMapTap = () => {
    setSelectedBagId(null);
    setSelectionDismissed(true);
  };

  const onMapGesture = () => {
    if (!mapMovedByUser && alive.current) setMapMovedByUser(true);
  };

  const onPinTap = (id: string) => {
    const bag = bags.find((item) => item.id === id);
    const point = bag ? merchantPoint(bag) : null;
    if (!bag || !point) return;
    setSelectedBagId(bag.id);
    setSelectionDismissed(false);
    const map = controller.current;
    if (map) map.move(point, map.zoom(), { x: 0, y: -70 });
  };

  const showFilters = async () => {
    const filter = await AppNav.showFilter();
    if (!alive.current || !filter) return;
    await appState.setBagFilter(filter);
    if (!alive.current) return;
    setSelectedBagId(null);
    setSelectionDismissed(false);
    setMapMovedByUser(false);
  };

  const recenter = async () => {
    if (locationBusyRef.current) return;
    setLocationBusy(true);
    try {
      const located = await appState.determineLocation();
      if (!alive.current) return;
      const userCenter = pointOf(appState.userLatitude, appState.userLongitude);
      if (located && userCenter) {
        controller.current?.move(userCenter, 15.5);
        setMapMovedByUser(false);
        const accuracy = appState.userLocationAccuracyMeters;
        if (appState.userLocationAccuracyReduced) {
          snack(
            appState.usesBrowserPermissionSettings
              ? "Browser memberi lokasi perkiraan. Periksa izin lokasi situs di bilah alamat bila ingin memperbarui titik."
              : "Perangkat memberi lokasi perkiraan. Aktifkan lokasi presisi di pengaturan agar titik lebih akurat.",
          );
        } else if (accuracy !== null && accuracy > 100) {
          snack(`Sinyal GPS masih lemah (akurasi sekitar ±${Math.round(accuracy)} m). Coba lagi di area terbuka.`);
        }
      } else {
        const message =
          appState.usesBrowserPermissionSettings && (!appState.locationServicesEnabled || !appState.hasLocationPermission)
            ? appState.browserLocationPermissionGuidance
            : !appState.locationServicesEnabled
              ? "Aktifkan layanan lokasi perangkat lalu coba lagi."
              : appState.locationPermissionDeniedForever
                ? "Izin lokasi diblokir. Aktifkan melalui pengaturan aplikasi."
                : (appState.errorMessage ?? "Lokasi terbaru belum berhasil ditemukan.");
        snack(message);
      }
    } catch {
      if (alive.current) snack(appState.errorMessage ?? "Lokasi belum berhasil ditemukan.");
    } finally {
      if (alive.current) setLocationBusy(false);
    }
  };

  const searchThisArea = async () => {
    const map = controller.current;
    if (areaBusyRef.current || !mapReady.current || !map) return;
    setAreaBusy(true);
    try {
      const center = map.center();
      lastSyncedCenter.current = center;
      await appState.setLocationWithCoordinates("Area peta", center.latitude, center.longitude);
      if (!alive.current) return;
      const error = appState.consumerError;
      if (error !== null) {
        snack(error);
        setMapMovedByUser(true);
        return;
      }
      setMapMovedByUser(false);
      setSelectedBagId(null);
    } catch {
      if (alive.current) snack(appState.consumerError ?? "Bag di area ini gagal dimuat.");
    } finally {
      if (alive.current) setAreaBusy(false);
    }
  };

  const openLocationSettings = async () => {
    if (appState.usesBrowserPermissionSettings) {
      snack(appState.browserLocationPermissionGuidance);
      return;
    }
    const opened = await appState.openRelevantLocationSettings();
    if (!opened && alive.current) {
      snack("Pengaturan tidak dapat dibuka otomatis. Buka pengaturan perangkat dan izinkan lokasi untuk SaveBite.");
    }
  };

  const pins: MapPin[] = bags.flatMap((bag) => {
    const point = merchantPoint(bag);
    return point ? [{ id: bag.id, point, label: pinLabel(bag.salePrice), selected: bag.id === selected?.id }] : [];
  });

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", background: C.mapGridBg }}>
      {/* Own stacking context so Leaflet's pane z-indexes stay below the overlays. */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <ConsumerMapCanvas
          initialCenter={pointOf(state.userLatitude, state.userLongitude) ?? FALLBACK_CENTER}
          pins={pins}
          device={deviceCenter ? { point: deviceCenter, accuracyMeters: state.userLocationAccuracyMeters } : null}
          onReady={onMapReady}
          onTap={onMapTap}
          onGesture={onMapGesture}
          onPinTap={onPinTap}
        />
      </div>
      <div style={{ position: "absolute", top: safeTop(12), left: 16, right: 16 }}>
        <TopBar filterActive={!isFilterEmpty(state.currentFilter)} onFilter={() => void showFilters()} />
      </div>
      {mapMovedByUser ? (
        <div
          style={{
            position: "absolute",
            top: safeTop(72),
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <FilledButton
            label="Cari di area ini"
            onTap={areaBusy ? null : () => void searchThisArea()}
            color={C.green}
            icon={
              areaBusy ? (
                <Spinner size={16} strokeWidth={2} color={C.cream} />
              ) : (
                <Icon name="refresh" size={18} color={C.cream} />
              )
            }
            style={{ pointerEvents: "auto", boxShadow: elevationShadow(3), ...(areaBusy ? null : { color: C.cream }) }}
          />
        </div>
      ) : null}
      {hasDeviceLocation && !mapMovedByUser ? (
        <div
          style={{
            position: "absolute",
            top: safeTop(69),
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <LocationAccuracyChip
            accuracyMeters={state.userLocationAccuracyMeters}
            reduced={state.userLocationAccuracyReduced}
          />
        </div>
      ) : null}
      <div style={{ position: "absolute", right: 16, bottom: selected === null ? 54 : 178 }}>
        <MapControl tooltip="Tampilkan lokasiku" onTap={locationBusy ? null : () => void recenter()}>
          {locationBusy ? (
            <Spinner size={19} strokeWidth={2} color={C.green} />
          ) : (
            <Icon name="my_location" size={21} color={C.green} />
          )}
        </MapControl>
      </div>
      <div style={{ position: "absolute", left: 8, bottom: selected === null ? 8 : 142 }}>
        <AttributionLink />
      </div>
      {state.isLoadingConsumer && bags.length === 0 ? (
        <MapLoadingOverlay />
      ) : consumerError !== null && bags.length === 0 ? (
        <div style={{ position: "absolute", left: 24, right: 24, top: safeTop(112) }}>
          <MapMessage
            icon="cloud_off_outlined"
            title="Bag belum dapat dimuat"
            message={consumerError}
            actionLabel="Coba lagi"
            onAction={() => void appState.loadConsumerHome()}
          />
        </div>
      ) : bags.length === 0 ? (
        <div style={{ position: "absolute", left: 24, right: 24, top: safeTop(112) }}>
          <MapMessage
            icon="location_off_outlined"
            title={state.nearbyBags.length === 0 ? "Belum ada bag di area ini" : "Lokasi toko belum tersedia"}
            message={
              state.nearbyBags.length === 0
                ? "Geser peta lalu cari area lain, atau ubah filter."
                : "Toko belum menambahkan titik peta. Bag tetap dapat dilihat dari tab Beranda."
            }
            actionLabel={shouldOfferLocationSettings ? state.locationSettingsActionLabel : "Muat ulang"}
            onAction={
              shouldOfferLocationSettings ? () => void openLocationSettings() : () => void appState.loadConsumerHome()
            }
          />
        </div>
      ) : null}
      {selected ? (
        <div style={{ position: "absolute", left: 16, right: 16, bottom: 16 }}>
          <BottomCard bag={selected} />
        </div>
      ) : null}
    </div>
  );
}

/** `_topBar`: the search field (opens Search) and the filter button with its badge. */
function TopBar({ filterActive, onFilter }: { filterActive: boolean; onFilter: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: C.white,
        borderRadius: 14,
        boxShadow: elevationShadow(4, 0.2),
      }}
    >
      <button
        type="button"
        className="sb-ink"
        onClick={() => AppNav.toSearch()}
        style={{
          flex: 1,
          minWidth: 0,
          height: 48,
          display: "flex",
          alignItems: "center",
          paddingLeft: 14,
          borderRadius: 14,
          textAlign: "left",
        }}
      >
        <Icon name="search" size={19} color={C.muted} />
        <span style={{ ...ui(14, { color: C.mutedAlt }), ...ellipsis, flex: 1, marginLeft: 10 }}>Cari toko atau makanan…</span>
      </button>
      <IconButton
        tooltip="Filter peta"
        onTap={onFilter}
        icon={
          <span style={{ position: "relative", display: "block" }}>
            <Icon name="tune" size={20} color={C.green} />
            {filterActive ? <CountBadge background={C.terracotta} style={{ top: 0, right: 0 }} /> : null}
          </span>
        }
      />
      <span aria-hidden style={{ width: 3, flex: "none" }} />
    </div>
  );
}

/** `_bottomCard`: the selected bag; opens its detail. */
function BottomCard({ bag }: { bag: Bag }) {
  return (
    <button
      type="button"
      className="sb-ink"
      aria-label={`${bag.title}, ${bag.merchant.name}, ${formatRupiah(bag.salePrice)}`}
      onClick={() => AppNav.toDetail(bag)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        padding: 12,
        background: C.white,
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: elevationShadow(8, 0.3),
        textAlign: "left",
      }}
    >
      <span style={{ display: "block", width: 76, height: 76, borderRadius: 13, overflow: "hidden", flex: "none" }}>
        <FoodImage path={bag.image} width={76} height={76} />
      </span>
      <span style={{ flex: 1, minWidth: 0, marginLeft: 12, display: "flex", flexDirection: "column" }}>
        <span style={{ ...display(15, { weight: 700 }), ...ellipsis }}>{bag.title}</span>
        <span style={{ display: "flex", alignItems: "center", marginTop: 3 }}>
          <span style={{ ...ui(12.5, { weight: 600, color: C.body }), ...ellipsis, flex: 1 }}>{bag.merchant.name}</span>
          <span style={{ ...ui(11.5, { weight: 600, color: C.body }), whiteSpace: "nowrap", flex: "none" }}>
            {`★ ${bag.merchant.rating.toFixed(1)}`}
          </span>
        </span>
        <span style={{ ...ui(11.5, { color: C.body }), ...ellipsis, marginTop: 5 }}>
          {`${bag.merchant.distance} · ambil ${bag.pickupWindow}`}
        </span>
        <span style={{ display: "block", marginTop: 5 }}>
          <PriceTag salePrice={bag.salePrice} originalPrice={bag.originalPrice} saleSize={16} />
        </span>
      </span>
      <span aria-hidden style={{ width: 4, flex: "none" }} />
      <Icon name="chevron_right" color={C.chevron} />
    </button>
  );
}

/** `_MapControl`: white circular button (elevation 4) around an `IconButton`. */
function MapControl({ tooltip, onTap, children }: { tooltip: string; onTap: (() => void) | null; children: ReactNode }) {
  return (
    <div style={{ background: C.white, borderRadius: "50%", boxShadow: elevationShadow(4) }}>
      <IconButton tooltip={tooltip} onTap={onTap} icon={children} />
    </div>
  );
}

/** `_LocationAccuracyChip`. */
function LocationAccuracyChip({ accuracyMeters, reduced }: { accuracyMeters: number | null; reduced: boolean }) {
  const accuracyText = accuracyMeters === null ? "" : ` · ±${Math.round(accuracyMeters)} m`;
  const color = reduced ? C.terracotta : C.green;
  return (
    <div
      role={reduced ? "status" : undefined}
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        padding: "6px 10px",
        background: withAlpha(C.white, 0.94),
        borderRadius: 999,
        boxShadow: elevationShadow(2),
      }}
    >
      <span className="sb-sr-only">
        {reduced ? `Lokasi perangkat berupa perkiraan${accuracyText}` : `Akurasi lokasi perangkat${accuracyText}`}
      </span>
      <Icon name={reduced ? "gps_not_fixed" : "gps_fixed"} size={14} color={color} />
      <span aria-hidden style={{ ...ui(10.5, { weight: 700, color }), marginLeft: 5, whiteSpace: "nowrap" }}>
        {`${reduced ? "Lokasi perkiraan" : "GPS"}${accuracyText}`}
      </span>
    </div>
  );
}

/** `_AttributionLink`: opens the OpenStreetMap copyright page in a new tab. */
function AttributionLink() {
  return (
    <a
      href={OSM_COPYRIGHT}
      target="_blank"
      rel="noopener noreferrer"
      className="sb-ink"
      style={{
        display: "block",
        padding: "3px 5px",
        background: withAlpha(C.white, 0.9),
        borderRadius: 4,
        ...ui(9.5, { color: C.body }),
      }}
    >
      © OpenStreetMap contributors
    </a>
  );
}

/** `_MapLoadingOverlay`: cream veil + spinner; lets taps through. */
function MapLoadingOverlay() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: withAlpha(C.cream, 0.58),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Spinner color={C.greenBright} label="Memuat lokasi toko" />
    </div>
  );
}

/** `_MapMessage`: floating card with an icon, a message, and one text action. */
function MapMessage({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        padding: 14,
        background: C.white,
        borderRadius: 16,
        boxShadow: elevationShadow(5),
      }}
    >
      <Icon name={icon} size={23} color={C.green} />
      <div style={{ flex: 1, minWidth: 0, marginLeft: 11, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <p style={ui(14, { weight: 700 })}>{title}</p>
        <p style={{ ...ui(12, { color: C.body, height: 1.4 }), marginTop: 3 }}>{message}</p>
        <Gap h={3} />
        {/* styleFrom(padding: zero, minimumSize: Size(44, 40), alignment: centerLeft) */}
        <TextButton
          label={actionLabel}
          onTap={onAction}
          style={{ padding: 0, minWidth: 44, justifyContent: "flex-start", textAlign: "left" }}
        />
      </div>
    </div>
  );
}
