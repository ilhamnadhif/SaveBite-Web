"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MapPin, UploadCloud } from "lucide-react";
import {
  PageHeading,
  Panel,
  describeError,
  parseCoordinate,
  requiredText,
  storageObjectPath,
  useAsyncData,
  validateImageFile,
  verifyImageSignature,
} from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import type { Merchant } from "../../../components/MerchantData";

const CATEGORIES = ["Bakery", "Cafe", "Restaurant", "Grocery", "Dessert", "Other"];
const LOGO_BUCKET = "store-logos";
const MAX_STORE_NAME = 100;
const MAX_DESCRIPTION = 1000;
const MAX_ADDRESS = 300;

export default function MerchantProfilePage() {
  const [form, setForm] = useState({ store_name: "", category: "Bakery", description: "", address: "", open_time: "", close_time: "", lat: "", lng: "" });
  const [logo, setLogo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const hydrated = useRef(false);

  const { data: store, loading, error: loadError, reload } = useAsyncData<Merchant | null>(
    async () => {
      const { data, error: rpcError } = await supabaseBrowser().rpc("get_my_merchant");
      if (rpcError) throw rpcError;
      return (data ?? null) as Merchant | null;
    },
    { scope: "merchantProfile.load", initialData: null },
  );

  // Hydrate once; a background reload must not clobber in-progress edits.
  const seed = store;
  useEffect(() => {
    if (!seed || hydrated.current) return;
    hydrated.current = true;
    setForm({
      store_name: seed.store_name,
      category: seed.category ?? "Bakery",
      description: seed.description ?? "",
      address: seed.address ?? "",
      open_time: seed.open_time ?? "08.00",
      close_time: seed.close_time ?? "21.00",
      lat: seed.lat == null ? "" : String(seed.lat),
      lng: seed.lng == null ? "" : String(seed.lng),
    });
  }, [seed]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!store || busy) return;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const db = supabaseBrowser();
      const storeName = requiredText(form.store_name, MAX_STORE_NAME);
      if (!storeName) throw new Error("Nama toko wajib diisi.");
      const address = requiredText(form.address, MAX_ADDRESS);
      if (!address) throw new Error("Alamat toko wajib diisi.");

      const lat = form.lat ? parseCoordinate(form.lat, "lat") : null;
      const lng = form.lng ? parseCoordinate(form.lng, "lng") : null;
      if (form.lat && lat === null) throw new Error("Latitude harus antara -90 dan 90.");
      if (form.lng && lng === null) throw new Error("Longitude harus antara -180 dan 180.");
      if ((lat === null) !== (lng === null)) {
        throw new Error("Isi latitude dan longitude sekaligus, atau kosongkan keduanya.");
      }

      let logoUrl: string | null = store.logo_url ?? null;
      if (logo) {
        const shallow = validateImageFile(logo);
        if (!shallow.ok) throw new Error(shallow.error);
        const verified = await verifyImageSignature(logo);
        if (!verified.ok) throw new Error(verified.error);

        const { data: auth } = await db.auth.getUser();
        const ownerId = auth.user?.id ?? "";
        if (!ownerId) throw new Error("Sesi kamu sudah berakhir. Silakan masuk kembali.");

        const path = storageObjectPath(ownerId, logo, "logo");
        const { error: uploadError } = await db.storage.from(LOGO_BUCKET).upload(path, logo, {
          upsert: false,
          contentType: verified.type,
          cacheControl: "31536000",
        });
        if (uploadError) throw uploadError;
        logoUrl = db.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
      }

      const { error: updateError } = await db
        .from("merchants")
        .update({
          store_name: storeName,
          category: form.category,
          description: requiredText(form.description, MAX_DESCRIPTION) ?? "",
          address,
          open_time: form.open_time.trim().slice(0, 20),
          close_time: form.close_time.trim().slice(0, 20),
          lat,
          lng,
          logo_url: logoUrl,
        })
        .eq("id", store.id);
      if (updateError) throw updateError;
      setMessage("Profil toko berhasil disimpan.");
    } catch (caught) {
      setError(describeError(caught, "merchantProfile.save", { merchantId: store.id }));
    } finally {
      setBusy(false);
    }
  }

  function locate() {
    if (!navigator.geolocation) {
      setError("Perangkat kamu tidak mendukung pengambilan lokasi.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setForm((current) => ({ ...current, lat: String(coords.latitude), lng: String(coords.longitude) }));
        setLocating(false);
      },
      () => {
        setError("Lokasi tidak tersedia.");
        setLocating(false);
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  return <>
    <PageHeading eyebrow="IDENTITAS TOKO" title="Profil toko" description="Informasi ini tampil pada katalog dan peta konsumen."/>
    <Panel className="profile-panel">
      {loadError && <div className="alert alert-error" role="alert">{loadError} <button className="text-link" onClick={reload}>Coba lagi</button></div>}
      {loading && !store ? (
        <div className="loading-screen" aria-busy="true"><span className="spinner"/>Memuat profil…</div>
      ) : !store ? (
        <div className="alert alert-error" role="alert">Toko belum ditemukan.</div>
      ) : (
        <form onSubmit={(event) => void save(event)}>
          <div className="store-profile-header">
            {store.logo_url
              ? <img src={store.logo_url} alt={`Logo ${store.store_name}`} width={48} height={48} loading="eager" decoding="async" referrerPolicy="no-referrer"/>
              : <span aria-hidden="true">S</span>}
            <div>
              <strong>{store.store_name}</strong>
              <small>{store.review_count ?? 0} ulasan · rating {Number(store.rating ?? 0).toFixed(1)}</small>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="p-store-name">Nama toko</label>
              <input id="p-store-name" value={form.store_name} onChange={(event) => setForm({ ...form, store_name: event.target.value })} required maxLength={MAX_STORE_NAME}/>
            </div>
            <div className="field">
              <label htmlFor="p-category">Kategori</label>
              <select id="p-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                {CATEGORIES.map((value) => <option key={value}>{value}</option>)}
              </select>
            </div>
            <div className="field wide">
              <label htmlFor="p-description">Deskripsi</label>
              <textarea id="p-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={MAX_DESCRIPTION}/>
            </div>
            <div className="field wide">
              <label htmlFor="p-address">Alamat</label>
              <input id="p-address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} required maxLength={MAX_ADDRESS}/>
            </div>
            <div className="field">
              <label htmlFor="p-open">Jam buka</label>
              <input id="p-open" value={form.open_time} onChange={(event) => setForm({ ...form, open_time: event.target.value })} maxLength={20}/>
            </div>
            <div className="field">
              <label htmlFor="p-close">Jam tutup</label>
              <input id="p-close" value={form.close_time} onChange={(event) => setForm({ ...form, close_time: event.target.value })} maxLength={20}/>
            </div>
            <div className="field">
              <label htmlFor="p-lat">Latitude</label>
              <input id="p-lat" value={form.lat} onChange={(event) => setForm({ ...form, lat: event.target.value })} inputMode="decimal"/>
            </div>
            <div className="field">
              <label htmlFor="p-lng">Longitude</label>
              <input id="p-lng" value={form.lng} onChange={(event) => setForm({ ...form, lng: event.target.value })} inputMode="decimal"/>
            </div>
            <div className="field wide">
              <label htmlFor="p-logo">Logo toko</label>
              <label className="image-picker" htmlFor="p-logo">
                <UploadCloud size={18}/>
                <span>{logo?.name || "Pilih gambar logo (maks. 5 MB)"}</span>
                <input id="p-logo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setLogo(event.target.files?.[0] ?? null)}/>
              </label>
            </div>
          </div>
          <button type="button" className="button button-secondary" disabled={locating} onClick={locate}>
            <MapPin size={14}/>{locating ? "Mencari lokasi…" : "Gunakan lokasi saya"}
          </button>
          {message && <div className="alert alert-success" role="status">{message}</div>}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="form-submit-row">
            <button className="button button-primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan profil toko"}</button>
          </div>
        </form>
      )}
    </Panel>
  </>;
}
