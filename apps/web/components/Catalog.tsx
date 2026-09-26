"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Heart, MapPin, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { EmptyState, PageHeading, SmartImage, describeError, useAsyncData, useAuth } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah } from "@savebite/web-shared";
import type { BagRow } from "./types";

/**
 * Results are paged in the database rather than pulled whole and filtered in
 * the browser. The catalogue used to `select("*")` every row of
 * `available_bags` and filter in JS, which is fine for 20 demo rows and
 * unusable once a town has a few hundred stores. Page size is capped so a
 * single request cannot pull an unbounded payload.
 */
const PAGE_SIZE = 24;

/** Mirrors the taxonomy in the merchant setup form. */
const CATEGORIES = ["Bakery", "Cafe", "Restaurant", "Grocery", "Dessert", "Other"] as const;

/** Escapes a user string for use inside a PostgREST `or(...)` filter. */
function escapePostgrestPattern(value: string): string {
  return value.replace(/[,%()\\]/g, (match) => `\\${match}`);
}

export function BagCard({ bag, favorite = false, onFavorite }: { bag: BagRow; favorite?: boolean; onFavorite?: () => void }) {
  return <article className="bag-card">
    {bag.image_url ? <SmartImage src={bag.image_url} alt={bag.title} className="bag-image" /> : <div className="bag-image-placeholder" role="img" aria-label="Gambar bag belum tersedia">🥐</div>}
    <div className="bag-card-content">
      <div className="bag-card-meta"><span>{bag.merchant_category ?? "Surprise bag"}</span>{bag.merchant_rating && <span className="stars">★ {Number(bag.merchant_rating).toFixed(1)}</span>}</div>
      <h3>{bag.title}</h3><p>{bag.merchant_name} · {bag.merchant_address}</p>
      <div className="price-row"><strong>{rupiah(bag.sale_price)}</strong><del>{rupiah(bag.original_price)}</del></div>
      <div className="card-bottom"><small>{bag.quantity_left} bag tersisa · {bag.pickup_window || "Pickup hari ini"}</small><span className="card-buttons"><button className={`heart-button ${favorite ? "hearted" : ""}`} onClick={onFavorite} aria-pressed={favorite} aria-label={favorite ? "Hapus dari favorit" : "Simpan ke favorit"}><Heart size={17} fill={favorite ? "currentColor" : "none"}/></button><Link className="button button-primary" href={`/bags/${bag.id}`}>Lihat bag</Link></span></div>
    </div>
  </article>;
}

export default function Catalog({ mode = "all" }: { mode?: "all" | "favorites" }) {
  const [bags, setBags] = useState<BagRow[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Semua kategori");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const { user } = useAuth();

  // Debounce the search box: without this every keystroke fires a PostgREST
  // request, which on a 1-CPU VPS is both slow and a self-inflicted DoS.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
  }, []);

  // Any filter change restarts paging.
  useEffect(() => {
    setPage(0);
  }, [debouncedQuery, category, mode]);

  const favoritesOnly = mode === "favorites";

  const load = async (targetPage: number): Promise<{ rows: BagRow[]; more: boolean }> => {
    const db = supabaseBrowser();
    const to = targetPage * PAGE_SIZE + PAGE_SIZE - 1;

    if (favoritesOnly) {
      // Favourites are keyed by merchant, so the merchant list has to be
      // resolved first. Still paged, and still capped.
      if (!user) return { rows: [], more: false };
      const { data: favRows, error: favError } = await db
        .from("favorites")
        .select("merchant_id")
        .eq("consumer_id", user.id);
      if (favError) throw favError;

      const ids = (favRows ?? []).map((row) => row.merchant_id as string);
      if (!ids.length) return { rows: [], more: false };

      const { data, error } = await db
        .from("available_bags")
        .select("*")
        .in("merchant_id", ids)
        .order("created_at", { ascending: false })
        .range(targetPage * PAGE_SIZE, to);
      if (error) throw error;
      const rows = (data ?? []) as BagRow[];
      return { rows, more: rows.length === PAGE_SIZE };
    }

    let queryBuilder = db
      .from("available_bags")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(targetPage * PAGE_SIZE, to);

    if (category !== "Semua kategori") queryBuilder = queryBuilder.eq("merchant_category", category);
    if (debouncedQuery) {
      const pattern = `%${escapePostgrestPattern(debouncedQuery)}%`;
      queryBuilder = queryBuilder.or(
        `title.ilike.${pattern},description.ilike.${pattern},merchant_name.ilike.${pattern},merchant_category.ilike.${pattern}`,
      );
    }

    const { data, error, count } = await queryBuilder;
    if (error) throw error;
    const rows = (data ?? []) as BagRow[];
    const total = typeof count === "number" ? count : rows.length;
    return { rows, more: targetPage * PAGE_SIZE + rows.length < total };
  };

  const { data, loading, error, reload } = useAsyncData(async () => {
    const result = await load(page);
    return result;
  }, { deps: [page, debouncedQuery, category, favoritesOnly, user?.id], scope: "catalog.load", initialData: { rows: [] as BagRow[], more: false } });

  // Accumulate pages so "load more" appends instead of replacing.
  useEffect(() => {
    const rows = data?.rows ?? [];
    const more = data?.more ?? false;
    if (page === 0) {
      setBags(rows);
      setHasMore(more);
    } else if (rows.length) {
      setBags((current) => {
        const seen = new Set(current.map((bag) => bag.id));
        return [...current, ...rows.filter((bag) => !seen.has(bag.id))];
      });
      setHasMore(more);
    }
  }, [data, page]);

  // Favourites are independent of the bag query, so they load once per session
  // and survive the debounced refetch a search keystroke causes.
  const { data: favoriteSet, setData: setFavoriteSet } = useAsyncData(async () => {
    if (!user) return new Set<string>();
    const { data, error: favError } = await supabaseBrowser()
      .from("favorites")
      .select("merchant_id")
      .eq("consumer_id", user.id);
    if (favError) throw favError;
    return new Set((data ?? []).map((row) => row.merchant_id as string));
  }, { deps: [user?.id], scope: "catalog.favorites", initialData: new Set<string>() });

  const categories = useMemo(() => {
    const fromResults = bags.map((bag) => bag.merchant_category).filter((value): value is string => Boolean(value));
    return ["Semua kategori", ...Array.from(new Set([...CATEGORIES, ...fromResults]))];
  }, [bags]);

  const shown = favoritesOnly
    ? bags.filter((bag) => favoriteSet.has(bag.merchant_id))
    : bags;

  const [actionError, setActionError] = useState("");

  async function toggleFavorite(merchantId: string) {
    if (!user) {
      // Keep the return path so a deep-linked catalogue comes back here.
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = `/login${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`;
      return;
    }
    setActionError("");
    try {
      const { error: rpcError } = await supabaseBrowser().rpc("toggle_favorite", { p_merchant_id: merchantId });
      if (rpcError) throw rpcError;
      // The toggle is applied only after the server confirms, so a failure
      // leaves the heart exactly as it was.
      setFavoriteSet((current) => {
        const next = new Set(current);
        if (next.has(merchantId)) next.delete(merchantId);
        else next.add(merchantId);
        return next;
      });
    } catch (caught) {
      setActionError(describeError(caught, "catalog.toggleFavorite", { merchantId }));
    }
  }

  return <>
    <PageHeading
      eyebrow={mode === "favorites" ? "YANG KAMU SUKA" : "GOOD FOOD, LESS WASTE"}
      title={mode === "favorites" ? "Toko favorit" : "Temukan makanan enak"}
      description="Surprise bag dari tempat favoritmu, dengan harga lebih hemat."
      action={<Link href="/map" className="button button-secondary"><MapPin size={15}/>Lihat peta</Link>}
    />
    <div className="catalog-toolbar">
      <label className="catalog-search"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nama bag, toko, atau kategori" aria-label="Cari bag"/></label>
      <label className="catalog-select"><SlidersHorizontal size={15}/><select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter kategori">{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
      <span className="catalog-result"><Sparkles size={14}/>{shown.length} pilihan hari ini</span>
    </div>
    {error && <div className="alert alert-error" role="alert">{error} <button className="text-link" onClick={reload}>Coba lagi</button></div>}
    {actionError && <div className="alert alert-error" role="alert">{actionError}</div>}
    {loading && !shown.length
      ? <div className="catalog-loading" aria-busy="true"><span className="spinner"/>Mencari bag terbaik…</div>
      : shown.length
        ? <>
            <div className="bag-grid">{shown.map((bag) => <BagCard key={bag.id} bag={bag} favorite={favoriteSet.has(bag.merchant_id)} onFavorite={() => void toggleFavorite(bag.merchant_id)}/>)}</div>
            {hasMore && <div className="load-more"><button className="button button-secondary" disabled={loading} onClick={() => setPage((value) => value + 1)}>{loading ? "Memuat…" : "Muat lebih banyak"}</button></div>}
          </>
        : <EmptyState
            title={mode === "favorites" ? "Belum ada toko favorit" : "Belum ada bag yang cocok"}
            detail={!user && mode === "favorites" ? "Masuk untuk menyimpan toko yang kamu suka." : "Coba ubah pencarian atau kategori. Bag baru muncul setiap hari."}
            action={<Link href={mode === "favorites" && !user ? "/login" : "/"} className="button button-primary">{mode === "favorites" && !user ? "Masuk ke SaveBite" : "Lihat semua bag"}</Link>}
          />}
  </>;
}
