"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, QrCode, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { EmptyState, PageHeading, Panel, StatusPill, useAuth } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah, shortDate } from "@savebite/web-shared";
import { loadMidtransSnap } from "@savebite/web-shared/snap";

type OrderRow = { id: string; order_reference: string; status: string; created_at: string; total_amount: number; quantity: number; bag_title: string; bag_image_url?: string; merchant_name: string; pickup_window_snapshot?: string; payment_snap_token?: string; pickup_start_at?: string; pickup_end_at?: string; reviewed?: boolean };
export default function OrdersPage() {
  const { user } = useAuth(); const router = useRouter();
  const [orders,setOrders]=useState<OrderRow[]>([]); const [loading,setLoading]=useState(true); const [tab,setTab]=useState("active"); const [error,setError]=useState("");
  const [codes,setCodes]=useState<Record<string,string>>({}); const [qrTokens,setQrTokens]=useState<Record<string,string>>({}); const [working,setWorking]=useState("");
  const load=useCallback(async()=>{ if(!user){setLoading(false);return;} const {data,error:e}=await supabaseBrowser().from("consumer_orders").select("*").eq("consumer_id",user.id).order("created_at",{ascending:false}); if(e)setError(e.message);else setOrders((data??[]) as OrderRow[]);setLoading(false); },[user]);
  useEffect(()=>{void load();if(!user)return;const channel=supabaseBrowser().channel("consumer-orders-live").on("postgres_changes",{event:"*",schema:"public",table:"orders",filter:"consumer_id=eq."+user.id},()=>void load()).subscribe();return()=>{void supabaseBrowser().removeChannel(channel)}},[load,user]);
  async function makeCode(order:OrderRow) { setWorking(order.id);setError("");try{const {data,error:e}=await supabaseBrowser().rpc("issue_pickup_manual_code",{p_order_id:order.id});if(e)throw e;setCodes((v)=>({...v,[order.id]:String(data?.code??"")}));}catch(e){setError(e instanceof Error?e.message:"Kode pickup belum dapat dibuat.");}finally{setWorking("");} }
  async function makeQr(order:OrderRow) { setWorking(order.id);setError("");try{const {data,error:e}=await supabaseBrowser().rpc("issue_pickup_token",{p_order_id:order.id});if(e)throw e;setQrTokens((v)=>({...v,[order.id]:String(data?.pickup_code??"")}));}catch(e){setError(e instanceof Error?e.message:"QR pickup belum dapat dibuat.");}finally{setWorking("");} }
  async function pay(order:OrderRow) { try{let token=order.payment_snap_token;if(!token){const {data,error:e}=await supabaseBrowser().functions.invoke("midtrans-status",{body:{order_id:order.id}});if(e)throw e;token=data?.order?.payment_snap_token;}if(!token)throw new Error("Tautan pembayaran sudah tidak tersedia.");await loadMidtransSnap();window.snap?.pay(token,{onSuccess:()=>void load(),onPending:()=>void load(),onError:()=>void load(),onClose:()=>void load()});}catch(e){setError(e instanceof Error?e.message:"Pembayaran belum dapat dibuka.");} }
  const active=orders.filter((o)=>["pending","paid","preparing","ready"].includes(o.status));
  const history=orders.filter((o)=>!["pending","paid","preparing","ready"].includes(o.status));
  const visible=tab==="active"?active:history;
  if(!user)return <EmptyState title="Masuk untuk melihat pesanan" detail="Pesanan, pembayaran dan kode pickup kamu muncul di sini." action={<Link href="/login" className="button button-primary">Masuk ke SaveBite</Link>}/>;
  return <><PageHeading eyebrow="RINGKASAN AKTIVITAS" title="Pesanan kamu" description="Pantau pembayaran dan siapkan pickup bag dari toko." action={<button className="button button-secondary" onClick={()=>void load()}><RefreshCw size={14}/>Muat ulang</button>}/><div className="tab-row"><button className={tab==="active"?"active":""} onClick={()=>setTab("active")}>Berjalan <b>{active.length}</b></button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}>Riwayat <b>{history.length}</b></button></div>{error&&<div className="alert alert-error">{error}</div>}{loading?<div className="loading-screen"><span className="spinner"/>Memuat pesanan…</div>:visible.length?<Panel className="orders-panel"><div className="consumer-orders">{visible.map((order)=><article className="consumer-order" key={order.id}>
    <div className="consumer-order-top"><div>{order.bag_image_url?<img className="order-thumb" src={order.bag_image_url} alt=""/>:<div className="order-thumb order-placeholder">🥐</div>}<div><h3>{order.bag_title}</h3><p>{order.merchant_name} · {order.quantity} bag · {shortDate(order.created_at)}</p><small>#{order.order_reference}</small></div></div><StatusPill status={order.status}/></div>
    <div className="consumer-order-bottom"><div><span>Total</span><strong>{rupiah(order.total_amount)}</strong></div><div className="order-actions">
      {order.status==="pending"&&<button className="button button-primary" onClick={()=>void pay(order)}>Lanjut bayar</button>}
      {order.status==="ready"&&<><button className="button button-primary" disabled={working===order.id} onClick={()=>void makeCode(order)}><QrCode size={14}/>{codes[order.id]?"Terbitkan ulang kode":"Tampilkan kode pickup"}</button><button className="button button-secondary" disabled={working===order.id} onClick={()=>void makeQr(order)}><QrCode size={14}/>QR Flutter</button></>}
      {order.status==="redeemed"&&!order.reviewed&&<Link className="button button-secondary" href={"/reviews/"+order.id}>Beri ulasan</Link>}
      {order.status==="redeemed"&&order.reviewed&&<span className="review-done">✓ Ulasan terkirim</span>}
    </div></div>
    {codes[order.id]&&<div className="manual-code-box"><div><span>KODE PICKUP · MAKS. 5 MENIT</span><strong>{codes[order.id]}</strong><small><Clock3 size={12}/>Tunjukkan kode ini kepada merchant.</small></div><button className="button button-quiet" onClick={()=>setCodes((v)=>{const n={...v};delete n[order.id];return n})}>Tutup</button></div>}
    {qrTokens[order.id]&&<div className="manual-code-box qr-token-box"><div className="qr-box"><QRCodeSVG value={qrTokens[order.id]} size={152}/><small>QR tetap kompatibel dengan aplikasi Flutter.</small></div><button className="button button-quiet" onClick={()=>setQrTokens((v)=>{const n={...v};delete n[order.id];return n})}>Tutup</button></div>}
    {order.status==="ready"&&<div className="pickup-timing">Pickup: {order.pickup_window_snapshot||"ikuti jam toko"}{order.pickup_start_at&&order.pickup_end_at?" · "+shortDate(order.pickup_start_at)+" – "+shortDate(order.pickup_end_at):""}</div>}
  </article>)}</div></Panel>:<EmptyState title={tab==="active"?"Belum ada pesanan berjalan":"Belum ada riwayat pesanan"} detail={tab==="active"?"Saatnya menemukan surprise bag untuk diselamatkan.":"Pesanan yang selesai akan tersimpan di sini."} action={<Link href="/" className="button button-primary">Jelajahi surprise bag</Link>}/>}</>;
}
