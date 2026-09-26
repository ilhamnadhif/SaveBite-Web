"use client";

import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import Link from "next/link";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah } from "@savebite/web-shared";

/**
 * Only the columns the map actually draws. The old `select("*")` shipped every
 * bag description and image URL to render a handful of pins.
 */
type MapBag = {
  id: string;
  title: string;
  sale_price: number;
  merchant_name?: string;
  merchant_lat?: number | null;
  merchant_lng?: number | null;
};

const pin = new L.DivIcon({ className: "savebite-map-pin", html: "<span>✳</span>", iconSize: [34, 42], iconAnchor: [17, 40] });

function Recenter({ point }: { point: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(point, 12);
  }, [map, point]);
  return null;
}

export default function MapView() {
  const [bags, setBags] = useState<MapBag[]>([]);
  const [center, setCenter] = useState<[number, number]>([-6.2, 106.8167]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.resolve(
      supabaseBrowser()
        .from("available_bags")
        .select("id,title,sale_price,merchant_name,merchant_lat,merchant_lng")
        .not("merchant_lat", "is", null)
        .not("merchant_lng", "is", null)
        .limit(500),
    )
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) setError("Lokasi toko tidak dapat dimuat. Coba muat ulang halaman.");
        else setBags((data ?? []) as MapBag[]);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError("Lokasi toko tidak dapat dimuat. Coba muat ulang halaman.");
        setLoading(false);
      });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (active) setCenter([coords.latitude, coords.longitude]);
        },
        () => undefined,
        { timeout: 5000, maximumAge: 300_000 },
      );
    }

    return () => {
      active = false;
    };
  }, []);

  const markers: Array<MapBag & { lat: number; lng: number }> = bags.flatMap((bag) =>
    typeof bag.merchant_lat === "number" && typeof bag.merchant_lng === "number"
      ? [{ ...bag, lat: bag.merchant_lat, lng: bag.merchant_lng }]
      : [],
  );

  return <div className="map-view">
    {loading ? (
      <div className="map-skeleton" aria-busy="true"><span className="spinner"/>Memuat titik toko…</div>
    ) : (
      <MapContainer center={center} zoom={12} scrollWheelZoom>
        <Recenter point={center}/>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {markers.map((bag) => (
          <Marker key={bag.id} position={[bag.lat, bag.lng]} icon={pin}>
            <Popup>
              <div className="map-popup">
                <strong>{bag.merchant_name}</strong>
                {bag.title}
                <p>{rupiah(bag.sale_price)}</p>
                <Link href={"/bags/" + bag.id}>Lihat surprise bag →</Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    )}
    {!loading && !markers.length && (
      <div className="map-empty">{error || "Lokasi toko akan muncul jika data koordinat tersedia."}</div>
    )}
  </div>;
}
