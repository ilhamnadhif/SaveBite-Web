"use client";
import dynamic from "next/dynamic";
import { MapPin, Navigation } from "lucide-react";
import { PageHeading, Panel } from "@savebite/web-shared";
const MapView = dynamic(() => import("../../components/MapView"), { ssr: false, loading: () => <div className="map-skeleton"><span className="spinner"/>Menyiapkan peta…</div> });
export default function MapPage() {
  return <><PageHeading eyebrow="JELAJAHI SEKITARMU" title="Peta SaveBite" description="Temukan toko dengan surprise bag yang masih tersedia." action={<span className="location-row"><Navigation size={14}/>Menggunakan OpenStreetMap</span>}/><Panel><MapView/><div className="map-attribution"><MapPin size={13}/>Harga dan stok diperbarui dari katalog SaveBite · © OpenStreetMap contributors</div></Panel></>;
}
