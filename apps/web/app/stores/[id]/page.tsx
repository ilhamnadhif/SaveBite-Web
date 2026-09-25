"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MapPin, Star } from "lucide-react";
import { EmptyState, PageHeading } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { BagCard } from "../../../components/Catalog";
import type { BagRow } from "../../../components/types";
export default function StorePage() {
  const { id } = useParams<{ id: string }>(); const [bags,setBags]=useState<BagRow[]>([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{let live=true;void supabaseBrowser().from("available_bags").select("*").eq("merchant_id",id).then(({data})=>{if(live){setBags((data??[]) as BagRow[]);setLoading(false);}});return()=>{live=false}},[id]);
  const store=bags[0];
  return <><PageHeading eyebrow="TOKO SAVE BITE" title={store?.merchant_name ?? "Toko"} description={store?.merchant_address}/><div className="store-hero"><div className="store-brand-avatar">S</div><div><h2>{store?.merchant_name ?? "Mencari informasi toko…"}</h2><span><MapPin size={14}/>{store?.merchant_address || "Alamat toko"}</span>{store?.merchant_rating ? <span><Star size={14} fill="currentColor"/> {Number(store.merchant_rating).toFixed(1)} · {store.merchant_review_count ?? 0} ulasan</span> : null}</div></div>{loading?<div className="loading-screen"><span className="spinner"/>Memuat bag toko…</div>:bags.length?<div className="bag-grid">{bags.map((bag)=><BagCard key={bag.id} bag={bag}/>)}</div>:<EmptyState title="Belum ada bag tersedia" detail="Cek lagi nanti, toko ini biasanya menambahkan bag setiap hari."/>}</>;
}
