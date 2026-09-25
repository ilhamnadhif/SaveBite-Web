"use client";

import { useEffect, useState, type FormEvent } from "react";
import { EmptyState, PageHeading, Panel, useAuth } from "@savebite/web-shared";
import Link from "next/link";
import { supabaseBrowser } from "@savebite/web-shared/client";

type Profile={name?:string;email?:string;phone?:string;avatar_url?:string};
export default function ProfilePage(){
 const {user}=useAuth();const [profile,setProfile]=useState<Profile>({});const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [error,setError]=useState("");
 useEffect(()=>{if(!user)return;void supabaseBrowser().from("profiles").select("name,email,phone,avatar_url").eq("id",user.id).maybeSingle().then(({data})=>setProfile((data??{}) as Profile));},[user]);
 async function save(e:FormEvent){e.preventDefault();if(!user)return;setBusy(true);setError("");setMessage("");const {error:e2}=await supabaseBrowser().from("profiles").update({name:profile.name,phone:profile.phone}).eq("id",user.id);setBusy(false);if(e2)setError(e2.message);else setMessage("Profil berhasil disimpan.");}
 if(!user)return <EmptyState title="Masuk untuk mengelola profil" detail="Gunakan akun Google yang sama untuk mengakses profil SaveBite." action={<Link href="/login" className="button button-primary">Masuk ke SaveBite</Link>}/>;
 return <><PageHeading eyebrow="PENGATURAN AKUN" title="Profil kamu" description="Kelola informasi yang dipakai untuk pesanan SaveBite."/><Panel className="profile-panel"><form onSubmit={(e)=>void save(e)}><div className="profile-heading"><div className="profile-avatar">{(profile.name??user?.email??"S").slice(0,1).toUpperCase()}</div><div><h2>{profile.name||"Pengguna SaveBite"}</h2><span>{profile.email||user?.email}</span></div></div><div className="form-grid"><div className="field"><label htmlFor="name">Nama</label><input id="name" value={profile.name??""} onChange={(e)=>setProfile({...profile,name:e.target.value})} required maxLength={80}/></div><div className="field"><label htmlFor="phone">Nomor telepon</label><input id="phone" value={profile.phone??""} onChange={(e)=>setProfile({...profile,phone:e.target.value})} placeholder="+62 812…" maxLength={30}/></div><div className="field wide"><label>Email akun</label><input value={profile.email??user?.email??""} disabled/></div></div>{message&&<div className="alert alert-success">{message}</div>}{error&&<div className="alert alert-error">{error}</div>}<button className="button button-primary" disabled={busy}>{busy?"Menyimpan…":"Simpan profil"}</button></form></Panel></>;
}
