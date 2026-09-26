"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { MapPin, Star } from "lucide-react";
import { EmptyState, PageHeading, useAsyncData } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { BagCard } from "../../../components/Catalog";
import type { BagRow } from "../../../components/types";

export default function StorePage() {
  const { id } = useParams<{ id: string }>();
  const [limit, setLimit] = useState(12);

  const { data, loading, error, reload } = useAsyncData<BagRow[]>(
    async () => {
      const { data: rows, error: queryError } = await supabaseBrowser()
        .from("available_bags")
        .select("*")
        .eq("merchant_id", id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (queryError) throw queryError;
      return (rows ?? []) as BagRow[];
    },
    { deps: [id, limit], scope: "store.load", initialData: [] },
  );

  const bags = data ?? [];
  // Store metadata is denormalised onto every bag row, so any row is a valid
  // source. The previous code used `bags[0]`, which rendered "Toko" and a
  // placeholder avatar whenever the store had no available bags at all.
  const store = bags[0];

  return <>
    <PageHeading eyebrow="TOKO SAVE BITE" title={store?.merchant_name ?? "Toko"} description={store?.merchant_address}/>
    <div className="store-hero">
      {store?.merchant_logo_url
        ? <img className="store-brand-avatar" src={store.merchant_logo_url} alt={store.merchant_name ?? "Logo toko"} width={53} height={53} loading="eager" decoding="async" referrerPolicy="no-referrer"/>
        : <div className="store-brand-avatar" aria-hidden="true">S</div>}
      <div>
        <h2>{store?.merchant_name ?? (loading ? "Memuat toko…" : "Toko SaveBite")}</h2>
        {store?.merchant_address && <span><MapPin size={14}/>{store.merchant_address}</span>}
        {store?.merchant_rating ? (
          <span><Star size={14} fill="currentColor"/> {Number(store.merchant_rating).toFixed(1)} · {store.merchant_review_count ?? 0} ulasan</span>
        ) : null}
      </div>
    </div>

    {error && <div className="alert alert-error" role="alert">{error} <button className="text-link" onClick={reload}>Coba lagi</button></div>}

    {loading && !bags.length ? (
      <div className="loading-screen" aria-busy="true"><span className="spinner"/>Memuat bag toko…</div>
    ) : bags.length ? (
      <>
        <div className="bag-grid">{bags.map((bag) => <BagCard key={bag.id} bag={bag}/>)}</div>
        {bags.length >= limit && (
          <div className="load-more">
            <button className="button button-secondary" onClick={() => setLimit((value) => value + 12)}>Muat lebih banyak</button>
          </div>
        )}
      </>
    ) : (
      <EmptyState
        title="Belum ada bag tersedia"
        detail={error ? "Toko tidak dapat dimuat." : "Cek lagi nanti, toko ini biasanya menambahkan bag setiap hari."}
        action={error ? <button className="button button-primary" onClick={reload}>Coba lagi</button> : undefined}
      />
    )}
  </>;
}
