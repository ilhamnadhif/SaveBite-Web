"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Heart, MapPin, Minus, Plus, ShieldCheck, ShoppingBag, Star } from "lucide-react";
import { EmptyState, useAuth } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah } from "@savebite/web-shared";
import type { BagRow } from "../../../components/types";

export default function BagDetailPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const { user } = useAuth();
  const [bag, setBag] = useState<BagRow | null>(null); const [qty, setQty] = useState(1); const [favorite, setFavorite] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => {
    let live = true; const db = supabaseBrowser();
    void db.from("available_bags").select("*").eq("id", id).maybeSingle().then(({ data, error: e }) => {
      if (!live) return; if (e) setError(e.message); setBag((data as BagRow | null) ?? null); setLoading(false);
    });
    return () => { live = false; };
  }, [id]);
  useEffect(() => { if (!user || !bag) return; void supabaseBrowser().from("favorites").select("merchant_id").eq("merchant_id", bag.merchant_id).eq("consumer_id", user.id).maybeSingle().then(({ data }) => setFavorite(!!data)); }, [user, bag]);
  async function toggle() {
    if (!user) { router.push("/login"); return; }
    const { error: e } = await supabaseBrowser().rpc("toggle_favorite", { p_merchant_id: bag?.merchant_id });
    if (e) setError(e.message); else setFavorite(!favorite);
  }
  if (loading) return <div className="loading-screen"><span className="spinner"/>Memuat detail bag…</div>;
  if (!bag) return <EmptyState title="Bag tidak ditemukan" detail={error || "Bag ini mungkin sudah habis atau tidak tersedia."} action={<Link className="button button-secondary" href="/">Kembali ke katalog</Link>}/>;
  return <>
    <Link href="/" className="back-link"><ArrowLeft size={15}/>Kembali ke katalog</Link>
    <div className="detail-layout bag-detail-layout">
      <div>{bag.image_url ? <img className="detail-hero" src={bag.image_url} alt={bag.title}/> : <div className="detail-hero detail-placeholder">🥐</div>}<div className="detail-copy"><div className="eyebrow">{bag.merchant_category ?? "SURPRISE BAG"}</div><h1>{bag.title}</h1><p>{bag.description || "Pilihan kejutan berisi makanan enak yang masih layak dinikmati."}</p>{bag.contents?.length ? <div className="contents-list">{bag.contents.map((item) => <span key={item}>✳ {item}</span>)}</div> : null}</div></div>
      <div className="detail-aside">
        <div className="merchant-mini"><span className="merchant-mini-mark">S</span><div><strong>{bag.merchant_name}</strong><small><MapPin size={12}/>{bag.merchant_address || "Alamat tersedia di toko"}</small></div><button className={"heart-button " + (favorite ? "hearted" : "")} onClick={() => void toggle()}><Heart size={18} fill={favorite ? "currentColor" : "none"}/></button></div>
        <section className="price-panel"><span className="eyebrow">HARGA SPESIAL SAVE BITE</span><div className="detail-price"><strong>{rupiah(bag.sale_price)}</strong><del>{rupiah(bag.original_price)}</del></div><div className="saving-note"><Star size={14} fill="currentColor"/>Kamu hemat {rupiah(bag.original_price - bag.sale_price)}</div><hr/><div className="detail-fact"><span>Waktu pickup</span><strong>{bag.pickup_window || "Cek detail di toko"}</strong></div><div className="detail-fact"><span>Stok tersedia</span><strong>{bag.quantity_left} bag</strong></div><div className="qty-control"><span>Jumlah</span><div><button disabled={qty <= 1} onClick={() => setQty(qty - 1)}><Minus size={15}/></button><b>{qty}</b><button disabled={qty >= bag.quantity_left} onClick={() => setQty(qty + 1)}><Plus size={15}/></button></div></div><Link className="button button-primary buy-button" href={user ? "/checkout/" + bag.id + "?qty=" + qty : "/login"}><ShoppingBag size={16}/>Lanjut ke pembayaran · {rupiah(bag.sale_price * qty)}</Link><small className="secure-note"><ShieldCheck size={13}/>Pembayaran QRIS diproses oleh Midtrans</small>{error && <div className="alert alert-error">{error}</div>}</section>
        <Link className="store-link" href={"/stores/" + bag.merchant_id}>Lihat toko dan bag lainnya →</Link>
      </div>
    </div>
  </>;
}
