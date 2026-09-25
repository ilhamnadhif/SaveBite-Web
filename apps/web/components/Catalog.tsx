"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Heart, MapPin, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { PageHeading, EmptyState, useAuth } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah } from "@savebite/web-shared";
import type { BagRow } from "./types";

export function BagCard({ bag, favorite = false, onFavorite }: { bag: BagRow; favorite?: boolean; onFavorite?: () => void }) {
  return <article className="bag-card">
    {bag.image_url ? <img className="bag-image" src={bag.image_url} alt={bag.title}/> : <div className="bag-image-placeholder">🥐</div>}
    <div className="bag-card-content">
      <div className="bag-card-meta"><span>{bag.merchant_category ?? "Surprise bag"}</span>{bag.merchant_rating && <span className="stars">★ {Number(bag.merchant_rating).toFixed(1)}</span>}</div>
      <h3>{bag.title}</h3><p>{bag.merchant_name} · {bag.merchant_address}</p>
      <div className="price-row"><strong>{rupiah(bag.sale_price)}</strong><del>{rupiah(bag.original_price)}</del></div>
      <div className="card-bottom"><small>{bag.quantity_left} bag tersisa · {bag.pickup_window || "Pickup hari ini"}</small><span className="card-buttons"><button className={`heart-button ${favorite ? "hearted" : ""}`} onClick={onFavorite} title="Simpan ke favorit"><Heart size={17} fill={favorite ? "currentColor" : "none"}/></button><Link className="button button-primary" href={`/bags/${bag.id}`}>Lihat bag</Link></span></div>
    </div>
  </article>;
}

export default function Catalog({ mode = "all" }: { mode?: "all" | "favorites" | "merchant" }) {
  const [bags, setBags] = useState<BagRow[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Semua kategori");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { user } = useAuth();

  useEffect(() => { setQuery(new URLSearchParams(window.location.search).get("q") ?? ""); }, []);

  useEffect(() => {
    let live = true;
    const db = supabaseBrowser();
    async function load() {
      setLoading(true); setError("");
      const { data, error: bagError } = await db.from("available_bags").select("*").order("created_at", { ascending: false });
      if (!live) return;
      if (bagError) setError(bagError.message);
      else setBags((data ?? []) as BagRow[]);
      if (user) {
        const { data: favRows } = await db.from("favorites").select("merchant_id").eq("consumer_id", user.id);
        if (live) setFavorites(new Set((favRows ?? []).map((r) => r.merchant_id)));
      }
      setLoading(false);
    }
    void load();
    return () => { live = false; };
  }, [user]);

  const categories = useMemo(() => ["Semua kategori", ...Array.from(new Set(bags.map((b) => b.merchant_category).filter(Boolean) as string[]))], [bags]);
  const shown = useMemo(() => bags.filter((b) =>
    (mode !== "favorites" || favorites.has(b.merchant_id)) &&
    (category === "Semua kategori" || b.merchant_category === category) &&
    (!query || [b.title,b.description,b.merchant_name,b.merchant_category].some((v) => v?.toLowerCase().includes(query.toLowerCase())))
  ), [bags, favorites, mode, category, query]);

  async function toggleFavorite(id: string) {
    if (!user) { window.location.href = "/login"; return; }
    const { error: rpcError } = await supabaseBrowser().rpc("toggle_favorite", { p_merchant_id: id });
    if (rpcError) { setError(rpcError.message); return; }
    setFavorites((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  return <>
    <PageHeading eyebrow={mode === "favorites" ? "YANG KAMU SUKA" : "GOOD FOOD, LESS WASTE"} title={mode === "favorites" ? "Toko favorit" : "Temukan makanan enak"} description="Surprise bag dari tempat favoritmu, dengan harga lebih hemat." action={<Link href="/map" className="button button-secondary"><MapPin size={15}/>Lihat peta</Link>}/>
    <div className="catalog-toolbar">
      <label className="catalog-search"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nama bag, toko, atau kategori"/></label>
      <label className="catalog-select"><SlidersHorizontal size={15}/><select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
      <span className="catalog-result"><Sparkles size={14}/>{shown.length} pilihan hari ini</span>
    </div>
    {error && <div className="alert alert-error">{error}</div>}
    {loading ? <div className="catalog-loading"><span className="spinner"/>Mencari bag terbaik…</div> : shown.length ? <div className="bag-grid">{shown.map((bag) => <BagCard key={bag.id} bag={bag} favorite={favorites.has(bag.merchant_id)} onFavorite={() => void toggleFavorite(bag.merchant_id)}/>)}</div> : <EmptyState title={mode === "favorites" ? "Belum ada toko favorit" : "Belum ada bag yang cocok"} detail="Coba ubah pencarian atau kategori. Bag baru muncul setiap hari." action={<Link href="/" className="button button-secondary">Lihat semua bag</Link>}/>}
  </>;
}
