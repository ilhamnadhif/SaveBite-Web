"use client";

import { useEffect, useState } from "react";
import { MessageSquareQuote, Star } from "lucide-react";
import { EmptyState, Metric, PageHeading, Panel } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { shortDate } from "@savebite/web-shared";

type Review={review_id:string;order_id:string;order_reference:string;customer_name:string;rating:number;tags:string[];comment:string;created_at:string};
export default function ReviewsPage(){
 const [reviews,setReviews]=useState<Review[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
 useEffect(()=>{void supabaseBrowser().rpc("get_my_merchant_reviews").then(({data,error:e})=>{if(e)setError(e.message);else setReviews((data??[]) as Review[]);setLoading(false)});},[]);
 const average=reviews.length?reviews.reduce((s,r)=>s+r.rating,0)/reviews.length:0;
 return <><PageHeading eyebrow="SUARA PELANGGAN" title="Ulasan toko" description="Masukan pelanggan setelah menyelesaikan pickup."/><div className="metric-grid"><Metric label="Rating rata-rata" value={reviews.length?average.toFixed(1)+" / 5":"—"} hint="Dari pesanan yang sudah selesai" icon={<Star size={16}/>}/><Metric label="Jumlah ulasan" value={String(reviews.length)} hint="Ulasan konsumen" accent="gold" icon={<MessageSquareQuote size={16}/>}/></div>{error&&<div className="alert alert-error">{error}</div>}{loading?<div className="loading-screen"><span className="spinner"/>Memuat ulasan…</div>:reviews.length?<div className="review-list">{reviews.map((r)=><Panel key={r.review_id} className="merchant-review"><div className="review-head"><div className="review-customer"><span>{r.customer_name.slice(0,1).toUpperCase()}</span><div><strong>{r.customer_name}</strong><small>Order #{r.order_reference} · {shortDate(r.created_at)}</small></div></div><div className="review-rating"><span>{"★".repeat(r.rating)}{"☆".repeat(5-r.rating)}</span><strong>{r.rating}.0</strong></div></div>{r.tags?.length>0&&<div className="review-tag-list">{r.tags.map((tag)=><span key={tag}>{tag}</span>)}</div>}{r.comment&&<blockquote>“{r.comment}”</blockquote>}</Panel>)}</div>:<EmptyState title="Belum ada ulasan" detail="Ulasan akan tampil setelah pelanggan selesai mengambil pesanannya."/>}</>;
}
