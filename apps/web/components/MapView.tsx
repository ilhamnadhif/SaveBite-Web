"use client";

import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import Link from "next/link";
import type { BagRow } from "./types";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah } from "@savebite/web-shared";

const pin = new L.DivIcon({ className: "savebite-map-pin", html: "<span>✳</span>", iconSize: [34, 42], iconAnchor: [17, 40] });
function Recenter({ point }: { point: [number, number] }) { const map = useMap(); useEffect(() => { map.setView(point, 12); }, [map, point]); return null; }

export default function MapView() {
  const [bags, setBags] = useState<BagRow[]>([]);
  const [center, setCenter] = useState<[number, number]>([-6.2, 106.8167]);
  const [error, setError] = useState("");
  useEffect(() => {
    void supabaseBrowser().from("available_bags").select("*").order("created_at", { ascending: false })
      .then(({ data, error: loadError }) => { if (loadError) setError(loadError.message); setBags((data ?? []) as BagRow[]); });
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(({ coords }) => setCenter([coords.latitude, coords.longitude]), () => undefined, { timeout: 5000 });
  }, []);
  const markers = bags.filter((b) => b.merchant_lat != null && b.merchant_lng != null);
  return <div className="map-view">
    <MapContainer center={center} zoom={12} scrollWheelZoom>
      <Recenter point={center}/>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
      {markers.map((bag) => <Marker key={bag.id} position={[bag.merchant_lat!, bag.merchant_lng!]} icon={pin}>
        <Popup><div className="map-popup"><strong>{bag.merchant_name}</strong>{bag.title}<p>{rupiah(bag.sale_price)}</p><Link href={"/bags/" + bag.id}>Lihat surprise bag →</Link></div></Popup>
      </Marker>)}
    </MapContainer>
    {!markers.length && <div className="map-empty">{error || "Lokasi toko akan muncul jika data koordinat tersedia."}</div>}
  </div>;
}
