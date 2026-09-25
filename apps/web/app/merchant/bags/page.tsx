"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CopyPlus, Edit2, Eye, EyeOff, Plus, ShoppingBag } from "lucide-react";
import { EmptyState, PageHeading, Panel } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah } from "@savebite/web-shared";
import type { MerchantBag } from "../../../components/MerchantData";

export default function BagsPage(){
 const [bags,setBags]=useState<MerchantBag[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
 const load=useCallback(async()=>{const {data,error:e}=await supabaseBrowser().from("surprise_bags").select("*").order("created_at",{ascending:false});if(e)setError(e.message);else setBags((data??[]) as MerchantBag[]);setLoading(false)},[]);
 useEffect(()=>{void load()},[load]);
 async function toggle(b:MerchantBag){const {error:e}=await supabaseBrowser().rpc("set_bag_active",{p_bag_id:b.id,p_active:b.status!=="active"});if(e)setError(e.message);else void load()}
 async function duplicate(b:MerchantBag){const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);const {error:e}=await supabaseBrowser().from("surprise_bags").insert({merchant_id:b.merchant_id,title:b.title,description:b.description,contents:b.contents,original_price:b.original_price,sale_price:b.sale_price,quantity_total:b.quantity_total,quantity_left:b.quantity_total,pickup_window:b.pickup_window,available_on:tomorrow,image_url:b.image_url,status:"active"});if(e)setError(e.message);else void load()}
 return <><PageHeading eyebrow="KATALOG TOKO" title="Surprise bag" description="Kelola stok yang tampil di halaman konsumen." action={<Link href="/merchant/bags/new" className="button button-primary"><Plus size={15}/>Tambah bag</Link>}/>{error&&<div className="alert alert-error">{error}</div>}{loading?<div className="loading-screen"><span className="spinner"/>Memuat katalog…</div>:bags.length?<div className="merchant-bag-list">{bags.map((b)=><article className="merchant-bag-row" key={b.id}>{b.image_url?<img src={b.image_url} alt=""/>:<div className="merchant-bag-placeholder">🥐</div>}<div className="merchant-bag-info"><div className="bag-card-meta"><span>{b.available_on??"Tanggal belum ditentukan"}</span><span className={"bag-status-dot "+b.status}>{b.status==="active"?"Aktif":b.status==="sold_out"?"Habis":"Disembunyikan"}</span></div><h3>{b.title}</h3><p>{b.quantity_left} tersisa dari {b.quantity_total} · {b.pickup_window}</p><div className="price-row"><strong>{rupiah(b.sale_price)}</strong><del>{rupiah(b.original_price)}</del></div></div><div className="merchant-bag-actions"><Link className="button button-secondary" href={"/merchant/bags/"+b.id+"/edit"}><Edit2 size={14}/>Edit</Link><button className="button button-secondary" onClick={()=>void toggle(b)}>{b.status==="active"?<EyeOff size={14}/>:<Eye size={14}/>} {b.status==="active"?"Sembunyikan":"Aktifkan"}</button><button className="button button-quiet" onClick={()=>void duplicate(b)} title="Duplikasi"><CopyPlus size={15}/></button></div></article>)}</div>:<EmptyState title="Belum ada surprise bag" detail="Tambahkan bag pertama agar pelanggan bisa menemukan produkmu." action={<Link href="/merchant/bags/new" className="button button-primary"><ShoppingBag size={15}/>Tambah bag</Link>}/>}</>;
}
