"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, CreditCard, PackageCheck, Star } from "lucide-react";
import { EmptyState, PageHeading, Panel, useAuth } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { shortDate } from "@savebite/web-shared";

type Notice={id:string;title:string;body:string;type:string;read:boolean;created_at:string;data?:Record<string,unknown>};
const iconFor=(type:string)=>type==="payment"?CreditCard:type==="order"?PackageCheck:type==="review"?Star:Bell;
export default function NotificationsPage(){
 const {user}=useAuth();const [rows,setRows]=useState<Notice[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
 async function load(){if(!user){setLoading(false);return}const {data,error:e}=await supabaseBrowser().from("notifications").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(100);if(e)setError(e.message);else setRows((data??[]) as Notice[]);setLoading(false)}
 useEffect(()=>{void load();if(!user)return;const channel=supabaseBrowser().channel("consumer-notifications").on("postgres_changes",{event:"*",schema:"public",table:"notifications",filter:"user_id=eq."+user.id},()=>void load()).subscribe();return()=>{void supabaseBrowser().removeChannel(channel)}},[user]);
 async function markAll(){await supabaseBrowser().from("notifications").update({read:true}).eq("user_id",user?.id);await load()}
 return <><PageHeading eyebrow="UPDATE TERBARU" title="Notifikasi" description="Informasi pembayaran, pickup, dan aktivitas akun." action={<button className="button button-secondary" onClick={()=>void markAll()}><CheckCheck size={14}/>Tandai semua dibaca</button>}/>{error&&<div className="alert alert-error">{error}</div>}{loading?<div className="loading-screen"><span className="spinner"/>Memuat notifikasi…</div>:rows.length?<Panel className="notifications-panel"><div className="notice-list">{rows.map((row)=>{const Icon=iconFor(row.type);const order=row.data?.order_id;return <Link href={typeof order==="string"?"/orders?order="+order:"/orders"} key={row.id} className={"notice-row "+(row.read?"read":"")}><span className="notice-icon"><Icon size={17}/></span><span className="notice-copy"><strong>{row.title}</strong><small>{row.body}</small><time>{shortDate(row.created_at)}</time></span>{!row.read&&<span className="notice-dot"/>}</Link>})}</div></Panel>:<EmptyState title="Belum ada notifikasi" detail="Kami akan menyimpan update penting pesanan di sini."/>}</>;
}
