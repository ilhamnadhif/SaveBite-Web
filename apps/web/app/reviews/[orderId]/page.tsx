"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Star } from "lucide-react";
import { PageHeading, Panel } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";

const tags=["Enak","Porsi pas","Pickup mudah","Kemasan baik","Harga hemat"];
export default function ReviewPage() {
  const {orderId}=useParams<{orderId:string}>();const router=useRouter();const [order,setOrder]=useState<Record<string,unknown>|null>(null);const [rating,setRating]=useState(5);const [selected,setSelected]=useState<string[]>([]);const [comment,setComment]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{void supabaseBrowser().from("consumer_orders").select("*").eq("id",orderId).maybeSingle().then(({data})=>setOrder(data as Record<string,unknown>|null));},[orderId]);
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError("");const {error:e2}=await supabaseBrowser().rpc("submit_review",{p_order_id:orderId,p_rating:rating,p_tags:selected,p_comment:comment.trim()});setBusy(false);if(e2){setError(e2.message);return}router.push("/orders");}
  return <><Link href="/orders" className="back-link"><ArrowLeft size={15}/>Kembali ke pesanan</Link><PageHeading eyebrow="BAGIKAN PENGALAMAN" title="Bagaimana bag kamu?" description={String(order?.merchant_name??"Ulasan membantu toko meningkatkan layanan.")}/><Panel className="review-form-panel"><form onSubmit={(e)=>void submit(e)}><div className="rating-picker" aria-label="Pilih rating">{[1,2,3,4,5].map((n)=><button type="button" key={n} onClick={()=>setRating(n)} className={n<=rating?"selected":""}><Star size={28} fill={n<=rating?"currentColor":"none"}/></button>)}</div><div className="field"><label>Apa yang paling kamu suka?</label><div className="review-tags">{tags.map((tag)=><button type="button" className={selected.includes(tag)?"selected":""} key={tag} onClick={()=>setSelected((v)=>v.includes(tag)?v.filter((x)=>x!==tag):[...v,tag])}>{tag}</button>)}</div></div><div className="field"><label htmlFor="comment">Ceritakan sedikit (opsional)</label><textarea id="comment" value={comment} onChange={(e)=>setComment(e.target.value)} placeholder="Bagikan pengalamanmu dengan komunitas SaveBite."/></div>{error&&<div className="alert alert-error">{error}</div>}<button className="button button-primary" disabled={busy}>{busy?"Mengirim…":"Kirim ulasan"}</button></form></Panel></>;
}
