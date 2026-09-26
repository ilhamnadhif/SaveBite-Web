"use client";

import { useEffect, useState, type FormEvent } from "react";
import { EmptyState, PageHeading, Panel, describeError, useAuth } from "@savebite/web-shared";
import Link from "next/link";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { requiredText } from "@savebite/web-shared";

type Profile = { name?: string; email?: string; phone?: string; avatar_url?: string };

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    // `Promise.resolve` normalises the PostgREST thenable (typed PromiseLike).
    void Promise.resolve(supabaseBrowser()
      .from("profiles")
      .select("name,email,phone,avatar_url")
      .eq("id", user.id)
      .maybeSingle())
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) {
          // Previously the error was dropped, which made an RLS or network
          // problem look exactly like an empty profile.
          setLoadError(describeError(queryError, "profile.load", { userId: user.id }));
        } else {
          setProfile((data ?? {}) as Profile);
        }
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setLoadError(describeError(caught, "profile.load", { userId: user.id }));
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    if (busy) return;

    const name = requiredText(profile.name, 80);
    if (!name) {
      setError("Nama tidak boleh kosong.");
      return;
    }
    const phone = requiredText(profile.phone, 30) ?? null;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const values = { name, phone };
      const { data, error: updateError } = await supabaseBrowser()
        .from("profiles")
        .update(values)
        .eq("id", user.id)
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;

      if (!data) {
        // The row does not exist yet (older accounts, or a trigger that has not
        // fired). The old code reported success here even though it had updated
        // zero rows, so the shopper's edit was silently discarded.
        const { error: insertError } = await supabaseBrowser()
          .from("profiles")
          .insert({ id: user.id, email: user.email ?? null, ...values });
        if (insertError) throw insertError;
      }

      setProfile((current) => ({ ...current, name, phone: phone ?? undefined }));
      setMessage("Profil berhasil disimpan.");
    } catch (caught) {
      setError(describeError(caught, "profile.save", { userId: user.id }));
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <EmptyState
        title="Masuk untuk mengelola profil"
        detail="Gunakan akun Google yang sama untuk mengakses profil SaveBite."
        action={<Link href="/login" className="button button-primary">Masuk ke SaveBite</Link>}
      />
    );
  }

  return <>
    <PageHeading eyebrow="PENGATURAN AKUN" title="Profil kamu" description="Kelola informasi yang dipakai untuk pesanan SaveBite."/>
    <Panel className="profile-panel">
      {loadError && <div className="alert alert-error" role="alert">{loadError}</div>}
      <form onSubmit={(event) => void save(event)}>
        <div className="profile-heading">
          <div className="profile-avatar" aria-hidden="true">{(profile.name ?? user.email ?? "S").slice(0, 1).toUpperCase()}</div>
          <div><h2>{profile.name || "Pengguna SaveBite"}</h2><span>{profile.email || user.email}</span></div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="name">Nama</label>
            <input id="name" value={profile.name ?? ""} onChange={(event) => setProfile({ ...profile, name: event.target.value })} required maxLength={80} disabled={!loaded && Boolean(loadError)}/>
          </div>
          <div className="field">
            <label htmlFor="phone">Nomor telepon</label>
            <input id="phone" value={profile.phone ?? ""} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="+62 812…" maxLength={30}/>
          </div>
          <div className="field wide">
            <label htmlFor="email-display">Email akun</label>
            <input id="email-display" value={profile.email ?? user.email ?? ""} disabled/>
            <small>Email dikelola oleh akun Google dan tidak dapat diubah di sini.</small>
          </div>
        </div>
        {message && <div className="alert alert-success" role="status">{message}</div>}
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <button className="button button-primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan profil"}</button>
      </form>
    </Panel>
  </>;
}
