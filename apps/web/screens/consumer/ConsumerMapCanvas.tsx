"use client";

import { divIcon, latLng, latLngBounds, type LatLngTuple, type PathOptions } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Circle, MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { C, argb, ui } from "../../ui/theme";

/**
 * The `FlutterMap` of the consumer map tab: OpenStreetMap tiles, the device
 * accuracy circle, the device marker, and one price pin per bag. Leaflet
 * touches `window` at import time, so `MapScreen` loads this module on the
 * client only and drives the camera through {@link MapCanvasController}, the
 * way the Dart screen uses flutter_map's `MapController`.
 */

export type MapPoint = { latitude: number; longitude: number };

export type MapPin = { id: string; point: MapPoint; label: string; selected: boolean };

/** The parts of flutter_map's `MapController` the map screen uses. */
export type MapCanvasController = {
  /** `move(center, zoom, offset:)`: instant; `offset` is in screen pixels. */
  move: (point: MapPoint, zoom: number, offset?: { x: number; y: number }) => void;
  /** `fitCamera(CameraFit.coordinates(coordinates:, padding:, maxZoom:))`. */
  fitPoints: (
    points: readonly MapPoint[],
    padding: { left: number; top: number; right: number; bottom: number },
    maxZoom: number,
  ) => void;
  /** `camera.center`. */
  center: () => MapPoint;
  /** `camera.zoom`. */
  zoom: () => number;
};

export type ConsumerMapCanvasProps = {
  /** `MapOptions.initialCenter` (read once, when the map is created). */
  initialCenter: MapPoint;
  pins: readonly MapPin[];
  /** The device fix while `_hasDeviceLocation`, otherwise null. */
  device: { point: MapPoint; accuracyMeters: number | null } | null;
  /** `onMapReady`; called again with null when the map goes away. */
  onReady: (controller: MapCanvasController | null) => void;
  /** `onTap` on the map itself (never for a tap on a pin). */
  onTap: () => void;
  /** `onPositionChanged` with `hasGesture == true`. */
  onGesture: () => void;
  onPinTap: (id: string) => void;
};

type Handlers = {
  ready: (controller: MapCanvasController | null) => void;
  tap: () => void;
  gesture: () => void;
  pinTap: (id: string) => void;
};

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** `CircleMarker(color: userDot @ 0.12, borderStrokeWidth: 1.5, borderColor: userDot @ 0.42)`. */
const ACCURACY_STYLE: PathOptions = {
  color: C.userDot,
  opacity: 0.42,
  weight: 1.5,
  fillColor: C.userDot,
  fillOpacity: 0.12,
};

// flutter_map paints its marker layers in list order: the device marker layer
// sits beneath the bag pins, and a later pin covers an earlier one. Leaflet
// orders markers by latitude, so the offsets restore the list order.
const USER_MARKER_Z = -1_000_000;
const PIN_Z_STEP = 1_000;

export function ConsumerMapCanvas(props: ConsumerMapCanvasProps) {
  const latest = useRef(props);
  latest.current = props;
  // Stable entry points for Leaflet listeners; they always call the latest props.
  const [handlers] = useState<Handlers>(() => ({
    ready: (controller) => latest.current.onReady(controller),
    tap: () => latest.current.onTap(),
    gesture: () => latest.current.onGesture(),
    pinTap: (id) => latest.current.onPinTap(id),
  }));
  const { initialCenter, pins, device } = props;

  return (
    <MapContainer
      center={[initialCenter.latitude, initialCenter.longitude]}
      zoom={14}
      minZoom={4}
      maxZoom={19}
      // flutter_map zooms continuously (no snapping), e.g. `move(…, 15.5)`.
      zoomSnap={0}
      zoomControl={false}
      attributionControl={false}
      style={{ position: "absolute", inset: 0, background: C.mapGridBg }}
    >
      <TileLayer url={OSM_TILES} maxNativeZoom={19} maxZoom={19} />
      {device && device.accuracyMeters !== null ? (
        <AccuracyCircle point={device.point} radius={Math.min(5000, Math.max(5, device.accuracyMeters))} />
      ) : null}
      {device ? <UserLocationMarker point={device.point} accuracyMeters={device.accuracyMeters} /> : null}
      {pins.map((pin, index) => (
        <PricePinMarker key={pin.id} pin={pin} zIndexOffset={index * PIN_Z_STEP} onTap={handlers.pinTap} />
      ))}
      <MapBridge handlers={handlers} />
    </MapContainer>
  );
}

/**
 * Connects the Leaflet map to the screen: the controller, `onTap`,
 * `onPositionChanged(hasGesture)`, and `invalidateSize()` whenever the tab
 * container is resized or shown again.
 */
function MapBridge({ handlers }: { handlers: Handlers }) {
  const map = useMap();

  useEffect(() => {
    // Programmatic camera moves run synchronously (`animate: false`), so any
    // `movestart` outside of them comes from a drag, pinch, wheel, double tap
    // or the keyboard — flutter_map's `hasGesture`.
    let programmatic = false;
    const moveProgrammatically = (action: () => void) => {
      programmatic = true;
      try {
        action();
      } finally {
        programmatic = false;
      }
    };

    const controller: MapCanvasController = {
      move: (point, zoom, offset) =>
        moveProgrammatically(() => {
          let target = latLng(point.latitude, point.longitude);
          if (offset && (offset.x !== 0 || offset.y !== 0)) {
            // flutter_map: newCenter = unproject(project(center) - offset).
            target = map.unproject(map.project(target, zoom).subtract([offset.x, offset.y]), zoom);
          }
          map.setView(target, zoom, { animate: false });
        }),
      fitPoints: (points, padding, maxZoom) =>
        moveProgrammatically(() => {
          map.fitBounds(latLngBounds(points.map((point): LatLngTuple => [point.latitude, point.longitude])), {
            paddingTopLeft: [padding.left, padding.top],
            paddingBottomRight: [padding.right, padding.bottom],
            maxZoom,
            animate: false,
          });
        }),
      center: () => {
        const center = map.wrapLatLng(map.getCenter());
        return { latitude: center.lat, longitude: center.lng };
      },
      zoom: () => map.getZoom(),
    };

    const onClick = () => handlers.tap();
    const onMoveStart = () => {
      if (!programmatic) handlers.gesture();
    };
    map.on("click", onClick);
    map.on("movestart", onMoveStart);

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.invalidateSize());
    observer?.observe(map.getContainer());

    handlers.ready(controller);
    return () => {
      handlers.ready(null);
      observer?.disconnect();
      map.off("click", onClick);
      map.off("movestart", onMoveStart);
    };
  }, [map, handlers]);

  return null;
}

function usePosition(point: MapPoint): LatLngTuple {
  const { latitude, longitude } = point;
  return useMemo<LatLngTuple>(() => [latitude, longitude], [latitude, longitude]);
}

/** A `L.divIcon` whose content is a React portal (no HTML strings). */
function usePortalIcon(width: number, height: number, anchor: [number, number], layout: string) {
  const [icon] = useState(() => {
    const element = document.createElement("div");
    element.style.cssText = `width:100%;height:100%;${layout}`;
    return {
      element,
      icon: divIcon({ html: element, className: "", iconSize: [width, height], iconAnchor: anchor }),
    };
  });
  return icon;
}

function AccuracyCircle({ point, radius }: { point: MapPoint; radius: number }) {
  const center = usePosition(point);
  return <Circle center={center} radius={radius} interactive={false} pathOptions={ACCURACY_STYLE} />;
}

/** `Marker(width: 42, height: 42, child: _UserMarker(...))`, centred on the fix. */
function UserLocationMarker({ point, accuracyMeters }: { point: MapPoint; accuracyMeters: number | null }) {
  const position = usePosition(point);
  const { element, icon } = usePortalIcon(42, 42, [21, 21], "display:flex;align-items:center;justify-content:center");
  return (
    <>
      <Marker position={position} icon={icon} interactive={false} keyboard={false} zIndexOffset={USER_MARKER_Z} />
      {createPortal(<UserMarker accuracyMeters={accuracyMeters} />, element)}
    </>
  );
}

/**
 * `Marker(width: 98, height: 58, alignment: Alignment.topCenter)`: the box sits
 * above the store's point and the pin is laid out at the top of it. The whole
 * box is tappable (`HitTestBehavior.opaque`).
 */
function PricePinMarker({ pin, zIndexOffset, onTap }: { pin: MapPin; zIndexOffset: number; onTap: (id: string) => void }) {
  const position = usePosition(pin.point);
  const { element, icon } = usePortalIcon(98, 58, [49, 58], "display:flex;flex-direction:column;align-items:center");
  const { id } = pin;
  // A marker with a click listener keeps the tap from reaching the map's `onTap`.
  const eventHandlers = useMemo(() => ({ click: () => onTap(id) }), [onTap, id]);
  return (
    <>
      <Marker position={position} icon={icon} keyboard={false} zIndexOffset={zIndexOffset} eventHandlers={eventHandlers} />
      {createPortal(<PricePin label={pin.label} selected={pin.selected} />, element)}
    </>
  );
}

/** `_PricePin`: price pill (animated 160 ms) above the `_TrianglePainter` pointer. */
function PricePin({ label, selected }: { label: string; selected: boolean }) {
  const background = selected ? C.terracotta : C.green;
  return (
    // Leaflet turns the click into the marker's `click` event (see PricePinMarker).
    <button
      type="button"
      aria-label={`Surprise Bag ${label}`}
      aria-pressed={selected}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}
    >
      <span
        style={{
          display: "block",
          padding: selected ? "8px 13px" : "7px 11px",
          background,
          borderRadius: 12,
          border: `2px solid ${C.white}`,
          boxShadow: `0 4px 10px ${argb(0x40000000)}`,
          whiteSpace: "nowrap",
          transition: "padding 160ms linear, background-color 160ms linear",
          ...ui(12, { weight: 800, color: C.white }),
        }}
      >
        {label}
      </span>
      <svg width={13} height={8} viewBox="0 0 13 8" aria-hidden focusable="false" style={{ display: "block", flex: "none" }}>
        <path d="M0 0H13L6.5 8Z" fill={background} />
      </svg>
    </button>
  );
}

/** `_UserMarker`: 18 px blue dot, 3 px white ring, 7 px translucent halo. */
function UserMarker({ accuracyMeters }: { accuracyMeters: number | null }) {
  return (
    <span
      role="img"
      aria-label={
        accuracyMeters === null ? "Lokasi kamu" : `Lokasi kamu, akurasi sekitar ${Math.round(accuracyMeters)} meter`
      }
      style={{
        display: "block",
        width: 18,
        height: 18,
        flex: "none",
        borderRadius: "50%",
        background: C.userDot,
        border: `3px solid ${C.white}`,
        boxShadow: `0 0 0 7px ${argb(0x552d7be5)}`,
      }}
    />
  );
}
