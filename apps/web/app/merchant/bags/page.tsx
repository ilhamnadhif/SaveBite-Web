"use client";

import Link from "next/link";
import { useState } from "react";
import { CopyPlus, Edit2, Eye, EyeOff, Plus, ShoppingBag } from "lucide-react";
import { EmptyState, PageHeading, SmartImage, describeError, useAsyncData, useRealtime } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah } from "@savebite/web-shared";
import type { MerchantBag } from "../../../components/MerchantData";

/** Bounded: a long-lived store should not pull an unbounded table. */
const MAX_BAGS = 100;

export default function BagsPage() {
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");

  const { data: bags, loading, error, reload } = useAsyncData<MerchantBag[]>(
    async () => {
      const { data, error: queryError } = await supabaseBrowser()
        .from("surprise_bags")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(MAX_BAGS);
      if (queryError) throw queryError;
      return (data ?? []) as MerchantBag[];
    },
    { scope: "merchantBags.load", initialData: [] },
  );

  useRealtime("merchant-bags", { table: "surprise_bags" }, reload);

  async function toggle(bag: MerchantBag) {
    if (busy) return;
    setBusy(bag.id);
    setActionError("");
    try {
      const { error: rpcError } = await supabaseBrowser().rpc("set_bag_active", {
        p_bag_id: bag.id,
        p_active: bag.status !== "active",
      });
      if (rpcError) throw rpcError;
      reload();
    } catch (caught) {
      setActionError(describeError(caught, "merchantBags.toggle", { bagId: bag.id }));
    } finally {
      setBusy("");
    }
  }

  async function duplicate(bag: MerchantBag) {
    if (busy) return;
    setBusy(bag.id);
    setActionError("");
    try {
      // Tomorrow's date, in the merchant's own timezone.
      const tomorrow = new Date(Date.now() + 86_400_000);
      const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 10);

      const { error: insertError } = await supabaseBrowser().from("surprise_bags").insert({
        merchant_id: bag.merchant_id,
        title: bag.title,
        description: bag.description,
        contents: bag.contents,
        original_price: bag.original_price,
        sale_price: bag.sale_price,
        quantity_total: bag.quantity_total,
        // A duplicate is a fresh offer, so stock starts full again.
        quantity_left: bag.quantity_total,
        pickup_window: bag.pickup_window,
        pickup_start_at: null,
        pickup_end_at: null,
        available_on: local,
        image_url: bag.image_url,
        status: "active",
      });
      if (insertError) throw insertError;
      reload();
    } catch (caught) {
      setActionError(describeError(caught, "merchantBags.duplicate", { bagId: bag.id }));
    } finally {
      setBusy("");
    }
  }

  return <>
    <PageHeading
      eyebrow="KATALOG TOKO"
      title="Surprise bag"
      description="Kelola stok yang tampil di halaman konsumen."
      action={<Link href="/merchant/bags/new" className="button button-primary"><Plus size={15}/>Tambah bag</Link>}
    />
    {error && <div className="alert alert-error" role="alert">{error} <button className="text-link" onClick={reload}>Coba lagi</button></div>}
    {actionError && <div className="alert alert-error" role="alert">{actionError}</div>}
    {loading && !bags.length ? (
      <div className="loading-screen" aria-busy="true"><span className="spinner"/>Memuat katalog…</div>
    ) : bags.length ? (
      <div className="merchant-bag-list">
        {bags.map((bag) => (
          <article className="merchant-bag-row" key={bag.id}>
            {bag.image_url
              ? <SmartImage src={bag.image_url} alt={bag.title} />
              : <div className="merchant-bag-placeholder" role="img" aria-label="Gambar belum tersedia">🥐</div>}
            <div className="merchant-bag-info">
              <div className="bag-card-meta">
                <span>{bag.available_on ?? "Tanggal belum ditentukan"}</span>
                <span className={"bag-status-dot " + bag.status}>
                  {bag.status === "active" ? "Aktif" : bag.status === "sold_out" ? "Habis" : "Disembunyikan"}
                </span>
              </div>
              <h3>{bag.title}</h3>
              <p>{bag.quantity_left} tersisa dari {bag.quantity_total} · {bag.pickup_window}</p>
              <div className="price-row"><strong>{rupiah(bag.sale_price)}</strong><del>{rupiah(bag.original_price)}</del></div>
            </div>
            <div className="merchant-bag-actions">
              <Link className="button button-secondary" href={"/merchant/bags/" + bag.id + "/edit"}><Edit2 size={14}/>Edit</Link>
              <button className="button button-secondary" disabled={busy === bag.id} onClick={() => void toggle(bag)}>
                {bag.status === "active" ? <EyeOff size={14}/> : <Eye size={14}/>} {bag.status === "active" ? "Sembunyikan" : "Aktifkan"}
              </button>
              <button className="button button-quiet" disabled={busy === bag.id} onClick={() => void duplicate(bag)} title="Duplikasi untuk besok" aria-label={`Duplikasi ${bag.title}`}>
                <CopyPlus size={15}/>
              </button>
            </div>
          </article>
        ))}
      </div>
    ) : (
      <EmptyState
        title="Belum ada surprise bag"
        detail="Tambahkan bag pertama agar pelanggan bisa menemukan produkmu."
        action={<Link href="/merchant/bags/new" className="button button-primary"><ShoppingBag size={15}/>Tambah bag</Link>}
      />
    )}
  </>;
}
