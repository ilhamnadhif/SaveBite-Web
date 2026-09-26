"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Heart, MapPin, Minus, Plus, ShieldCheck, ShoppingBag, Star } from "lucide-react";
import { EmptyState, SmartImage, describeError, useAsyncData, useAuth } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah } from "@savebite/web-shared";
import type { BagRow } from "../../../components/types";

export default function BagDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [qty, setQty] = useState(1);
  const [actionError, setActionError] = useState("");
  const { data: bag, loading, error, reload } = useAsyncData<BagRow | null>(
    async () => {
      const { data, error: queryError } = await supabaseBrowser()
        .from("available_bags")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (queryError) throw queryError;
      return (data as BagRow | null) ?? null;
    },
    { deps: [id], scope: "bagDetail.load", initialData: null },
  );

  const { data: isFavorite } = useAsyncData(
    async () => {
      if (!user || !bag) return false;
      const { data, error: favError } = await supabaseBrowser()
        .from("favorites")
        .select("merchant_id")
        .eq("merchant_id", bag.merchant_id)
        .eq("consumer_id", user.id)
        .maybeSingle();
      if (favError) throw favError;
      return Boolean(data);
    },
    { deps: [user?.id, bag?.merchant_id], scope: "bagDetail.favorite", initialData: false },
  );

  // Local copy so the heart can flip optimistically; it re-syncs whenever the
  // loaded value actually changes (i.e. after a refetch), but not on every render.
  const [favorite, setFavorite] = useState(false);
  useEffect(() => {
    setFavorite(isFavorite);
  }, [isFavorite]);
  async function toggle() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/bags/${id}`)}`);
      return;
    }
    setActionError("");
    try {
      const { error: rpcError } = await supabaseBrowser().rpc("toggle_favorite", { p_merchant_id: bag?.merchant_id });
      if (rpcError) throw rpcError;
      setFavorite((current) => !current);
    } catch (caught) {
      setActionError(describeError(caught, "bagDetail.toggleFavorite", { bagId: id }));
    }
  }

  if (loading && !bag) return <div className="loading-screen" aria-busy="true"><span className="spinner"/>Memuat detail bag…</div>;

  if (error) {
    return (
      <EmptyState
        title="Bag tidak dapat dimuat"
        detail={error}
        action={<button className="button button-primary" onClick={reload}>Coba lagi</button>}
      />
    );
  }

  if (!bag) {
    return <EmptyState title="Bag tidak ditemukan" detail="Bag ini mungkin sudah habis atau tidak tersedia." action={<Link className="button button-secondary" href="/">Kembali ke katalog</Link>}/>;
  }

  const maxQty = Math.max(1, bag.quantity_left);
  const safeQty = Math.min(Math.max(1, qty), maxQty);

  return <>
    <Link href="/" className="back-link"><ArrowLeft size={15}/>Kembali ke katalog</Link>
    <div className="detail-layout bag-detail-layout">
      <div>
        {bag.image_url
          ? <SmartImage src={bag.image_url} alt={bag.title} className="detail-hero" priority />
          : <div className="detail-hero detail-placeholder" role="img" aria-label="Gambar bag belum tersedia">🥐</div>}
        <div className="detail-copy">
          <div className="eyebrow">{bag.merchant_category ?? "SURPRISE BAG"}</div>
          <h1>{bag.title}</h1>
          <p>{bag.description || "Pilihan kejutan berisi makanan enak yang masih layak dinikmati."}</p>
          {bag.contents?.length ? <div className="contents-list">{bag.contents.map((item) => <span key={item}>✳ {item}</span>)}</div> : null}
        </div>
      </div>
      <div className="detail-aside">
        <div className="merchant-mini">
          <span className="merchant-mini-mark" aria-hidden="true">S</span>
          <div>
            <strong>{bag.merchant_name}</strong>
            <small><MapPin size={12}/>{bag.merchant_address || "Alamat tersedia di toko"}</small>
          </div>
          <button className={"heart-button " + (favorite ? "hearted" : "")} onClick={() => void toggle()} aria-pressed={favorite} aria-label={favorite ? "Hapus dari favorit" : "Simpan ke favorit"}>
            <Heart size={18} fill={favorite ? "currentColor" : "none"}/>
          </button>
        </div>
        <section className="price-panel">
          <span className="eyebrow">HARGA SPESIAL SAVE BITE</span>
          <div className="detail-price"><strong>{rupiah(bag.sale_price)}</strong><del>{rupiah(bag.original_price)}</del></div>
          <div className="saving-note"><Star size={14} fill="currentColor"/>Kamu hemat {rupiah(Math.max(0, bag.original_price - bag.sale_price))}</div>
          <hr/>
          <div className="detail-fact"><span>Waktu pickup</span><strong>{bag.pickup_window || "Cek detail di toko"}</strong></div>
          <div className="detail-fact"><span>Stok tersedia</span><strong>{bag.quantity_left} bag</strong></div>
          <div className="qty-control">
            <span>Jumlah</span>
            <div>
              <button type="button" disabled={safeQty <= 1} onClick={() => setQty(safeQty - 1)} aria-label="Kurangi jumlah"><Minus size={15}/></button>
              <b>{safeQty}</b>
              <button type="button" disabled={safeQty >= maxQty} onClick={() => setQty(safeQty + 1)} aria-label="Tambah jumlah"><Plus size={15}/></button>
            </div>
          </div>
          <Link className="button button-primary buy-button" href={user ? `/checkout/${bag.id}?qty=${safeQty}` : `/login?next=${encodeURIComponent(`/bags/${bag.id}`)}`}>
            <ShoppingBag size={16}/>Lanjut ke pembayaran · {rupiah(bag.sale_price * safeQty)}
          </Link>
          <small className="secure-note"><ShieldCheck size={13}/>Pembayaran QRIS diproses oleh Midtrans</small>
          {actionError && <div className="alert alert-error" role="alert">{actionError}</div>}
        </section>
        <Link className="store-link" href={"/stores/" + bag.merchant_id}>Lihat toko dan bag lainnya →</Link>
      </div>
    </div>
  </>;
}
