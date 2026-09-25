"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { PageHeading, useAuth } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { makeIdempotencyKey, rupiah } from "@savebite/web-shared";
import { loadMidtransSnap } from "@savebite/web-shared/snap";
import type { BagRow } from "../../../components/types";

type CheckoutOrder = { id?: string; order_id?: string; status?: string; payment_snap_token?: string; payment_expires_at?: string; total_amount?: number; order_reference?: string };
export default function CheckoutPage() {
  const { bagId } = useParams<{ bagId: string }>(); const params = useSearchParams(); const router = useRouter(); const { user } = useAuth();
  const [bag,setBag]=useState<BagRow|null>(null); const [qty,setQty]=useState(Math.max(1,Number(params.get("qty")||1))); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(""); const [error,setError]=useState("");
  useEffect(()=>{void supabaseBrowser().from("available_bags").select("*").eq("id",bagId).maybeSingle().then(({data})=>setBag((data as BagRow|null)??null));},[bagId]);
  async function refreshStatus(orderId: string) {
    const { error: statusError } = await supabaseBrowser().functions.invoke("midtrans-status", { body: { order_id: orderId } });
    if (statusError) setMessage("Pembayaran diproses. Status akan diperbarui pada halaman pesanan.");
    else setMessage("Status pembayaran sudah diperbarui.");
    setTimeout(() => router.push("/orders"), 1300);
  }
  async function pay() {
    if (!user) { router.push("/login"); return; }
    if (!bag) return; setBusy(true); setError(""); setMessage("");
    try {
      const { data, error: invokeError } = await supabaseBrowser().functions.invoke("midtrans-create", { body: { bag_id: bag.id, quantity: qty, payment_method: "QRIS", idempotency_key: makeIdempotencyKey() } });
      if (invokeError) throw invokeError;
      const order = (data?.order ?? {}) as CheckoutOrder;
      const token = order.payment_snap_token;
      if (!token) { setMessage("Pesanan sudah tercatat. Lanjutkan pembayaran dari halaman pesanan."); setTimeout(()=>router.push("/orders"),1500); return; }
      await loadMidtransSnap();
      window.snap?.pay(token, { onSuccess: () => void refreshStatus(order.id ?? order.order_id ?? ""), onPending: () => void refreshStatus(order.id ?? order.order_id ?? ""), onError: () => void refreshStatus(order.id ?? order.order_id ?? ""), onClose: () => void refreshStatus(order.id ?? order.order_id ?? "") });
      setMessage("Selesaikan pembayaran QRIS pada jendela Midtrans.");
    } catch (e) { setError(e instanceof Error ? e.message : "Checkout gagal dibuat."); }
    finally { setBusy(false); }
  }
  if (!bag) return <div className="loading-screen"><span className="spinner"/>Menyiapkan checkout…</div>;
  return <><Link href={"/bags/" + bag.id} className="back-link"><ArrowLeft size={15}/>Kembali ke detail</Link><PageHeading eyebrow="CHECKOUT AMAN" title="Pesanan kamu" description="Pembayaran QRIS diproses secara aman melalui Midtrans."/><div className="checkout-layout"><section className="panel checkout-summary"><h2>Ringkasan pesanan</h2><div className="checkout-bag">{bag.image_url?<img src={bag.image_url} alt=""/>:<div>🥐</div>}<span><strong>{bag.title}</strong><small>{bag.merchant_name} · {bag.pickup_window}</small></span></div><div className="qty-control"><span>Jumlah bag</span><div><button disabled={qty<=1} onClick={()=>setQty(qty-1)}>-</button><b>{qty}</b><button disabled={qty>=bag.quantity_left} onClick={()=>setQty(qty+1)}>+</button></div></div><div className="checkout-line"><span>Harga bag</span><b>{rupiah(bag.sale_price)} × {qty}</b></div><div className="checkout-line"><span>Biaya layanan</span><b>Ditampilkan saat checkout</b></div><div className="checkout-total"><span>Subtotal bag</span><strong>{rupiah(bag.sale_price*qty)}</strong></div><div className="pickup-info"><ShieldCheck size={17}/><span>Pastikan kamu dapat mengambil pesanan selama waktu pickup toko.</span></div><button className="button button-primary checkout-pay" disabled={busy} onClick={()=>void pay()}><LockKeyhole size={16}/>{busy?"Menyiapkan pembayaran…":"Bayar dengan QRIS"}</button>{message&&<div className="alert alert-success">{message}</div>}{error&&<div className="alert alert-error">{error}</div>}</section><aside className="checkout-aside"><div className="secure-illustration">✓</div><h3>Transaksi terlindungi</h3><p>Status pembayaran dikonfirmasi server Midtrans. Simpan QR pickup dari halaman pesanan setelah toko menyiapkan bag.</p><small>Jangan menutup jendela pembayaran sebelum status diperbarui.</small></aside></div></>;
}
