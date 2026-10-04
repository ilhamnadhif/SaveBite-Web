"use client";

/**
 * The map of `StoreLocationSection` (flutter_map + OpenStreetMap tiles in the
 * Flutter app). Leaflet touches `window` as soon as it is imported, so this
 * module must only be loaded on the client through `next/dynamic`.
 */
import { divIcon, type LeafletMouseEvent } from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { ICONS, type IconNode } from "../../ui/icons.generated";
import { C } from "../../ui/theme";

export type StoreMapPoint = { readonly latitude: number; readonly longitude: number };

/** `MapController.move`, handed out once the map is ready (`onMapReady`). */
export type StoreMapController = { move: (point: StoreMapPoint, zoom: number) => void };

export type StoreLocationMapProps = {
  /** `MapOptions.initialCenter`, read once when the map is created. */
  initialCenter: StoreMapPoint;
  /** `MapOptions.initialZoom`, read once when the map is created. */
  initialZoom: number;
  point: StoreMapPoint | null;
  synchronized: boolean;
  onTap: (point: StoreMapPoint) => void;
  onReady: (controller: StoreMapController | null) => void;
};

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * flutter_map holds a single tap back this long so that a double tap zooms
 * instead of also picking a point (positioned_tap_detector_2's default).
 */
const DOUBLE_TAP_DELAY_MS = 250;

/** `FlutterMap(minZoom: 4, maxZoom: 19)` with the OSM tile layer and the store pin. */
export function StoreLocationMap({ initialCenter, initialZoom, point, synchronized, onTap, onReady }: StoreLocationMapProps) {
  const latitude = point?.latitude ?? null;
  const longitude = point?.longitude ?? null;
  const position = useMemo<[number, number] | null>(
    () => (latitude !== null && longitude !== null ? [latitude, longitude] : null),
    [latitude, longitude],
  );
  const icon = useMemo(() => storePinIcon(synchronized), [synchronized]);
  return (
    <MapContainer
      center={[initialCenter.latitude, initialCenter.longitude]}
      zoom={initialZoom}
      minZoom={4}
      maxZoom={19}
      zoomControl={false}
      attributionControl={false}
      style={{ width: "100%", height: "100%", background: C.mapGridBg }}
    >
      <TileLayer url={TILE_URL} maxNativeZoom={19} maxZoom={19} />
      {position ? <Marker position={position} icon={icon} interactive={false} keyboard={false} /> : null}
      <MapEvents onTap={onTap} onReady={onReady} />
    </MapContainer>
  );
}

/** `onMapReady` and `onTap`. */
function MapEvents({ onTap, onReady }: Pick<StoreLocationMapProps, "onTap" | "onReady">) {
  const map = useMap();
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const report = readyRef.current;
    report({ move: (target, zoom) => map.setView([target.latitude, target.longitude], zoom, { animate: false }) });
    return () => report(null);
  }, [map]);

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
      if (pending !== null) clearTimeout(pending);
      pending = null;
    };
    const onClick = (event: LeafletMouseEvent) => {
      cancel();
      const { lat, lng } = event.latlng.wrap();
      pending = setTimeout(() => {
        pending = null;
        tapRef.current({ latitude: lat, longitude: lng });
      }, DOUBLE_TAP_DELAY_MS);
    };
    map.on("click", onClick);
    map.on("dblclick", cancel);
    return () => {
      cancel();
      map.off("click", onClick);
      map.off("dblclick", cancel);
    };
  }, [map]);

  return null;
}

/** `_StorePin`: a 50×50 disc (terracotta once synced) with a white storefront icon. */
function storePinIcon(synchronized: boolean) {
  const background = synchronized ? C.terracotta : C.muted;
  return divIcon({
    className: "",
    iconSize: [50, 50],
    iconAnchor: [25, 25],
    html:
      `<div style="width:50px;height:50px;box-sizing:border-box;border-radius:50%;background:${background};` +
      `border:3px solid ${C.white};box-shadow:0 3px 8px rgba(0, 0, 0, 0.2);display:flex;align-items:center;` +
      `justify-content:center">${iconSvg(ICONS.storefront, 23, C.white)}</div>`,
  });
}

/** The markup of `<Icon />`, for Leaflet's HTML marker. */
function iconSvg(nodes: readonly IconNode[], size: number, color: string): string {
  const children = nodes
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
        .join("");
      return `<${tag}${attributes}/>`;
    })
    .join("");
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" aria-hidden="true" ` +
    `focusable="false" style="display:block">${children}</svg>`
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
