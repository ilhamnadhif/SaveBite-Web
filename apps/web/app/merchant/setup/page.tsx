"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Store } from "lucide-react";
import { PageHeading, Panel, describeError, parseCoordinate, requiredText, useAuth } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";

const CATEGORIES = ["Bakery", "Cafe", "Restaurant", "Grocery", "Dessert", "Other"];
const MAX_STORE_NAME = 100;
const MAX_DESCRIPTION = 1000;
const MAX_ADDRESS = 300;

export default function StoreSetupPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    store_name: "",
    category: "Bakery",
    description: "",
    address: "",
    open_time: "08.00",
    close_time: "21.00",
    lat: "",
    lng: "",
  });

  async function locate() {
    if (!navigator.geolocation) {
      setError("Perangkat kamu tidak mendukung pengambilan lokasi. Isi koordinat secara manual.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setForm((current) => ({ ...current, lat: String(coords.latitude), lng: String(coords.longitude) }));
        setLocating(false);
      },
      () => {
        setError("Lokasi tidak dapat diambil. Isi koordinat secara manual.");
        setLocating(false);
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user || busy) return;
    setBusy(true);
    setError("");

    try {
      const storeName = requiredText(form.store_name, MAX_STORE_NAME);
      if (!storeName) throw new Error("Nama toko wajib diisi.");
      const address = requiredText(form.address, MAX_ADDRESS);
      if (!address) throw new Error("Alamat toko wajib diisi.");

      // Validate coordinates before they reach PostgREST; a bad value would
      // otherwise drop the store off the map with no explanation.
      const lat = form.lat ? parseCoordinate(form.lat, "lat") : null;
      const lng = form.lng ? parseCoordinate(form.lng, "lng") : null;
      if (form.lat && lat === null) throw new Error("Latitude harus antara -90 dan 90.");
      if (form.lng && lng === null) throw new Error("Longitude harus antara -180 dan 180.");
      if ((lat === null) !== (lng === null)) {
        throw new Error("Isi latitude dan longitude sekaligus, atau kosongkan keduanya.");
      }

      const { error: insertError } = await supabaseBrowser().from("merchants").insert({
        user_id: user.id,
        store_name: storeName,
        category: form.category,
        description: requiredText(form.description, MAX_DESCRIPTION) ?? "",
        address,
        open_time: form.open_time.trim().slice(0, 20),
        close_time: form.close_time.trim().slice(0, 20),
        lat,
        lng,
      });
      if (insertError) throw insertError;
      router.replace("/merchant");
    } catch (caught) {
      setError(describeError(caught, "merchant.setup", { userId: user.id }));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageHeading eyebrow="MULAI BERJUALAN" title="Siapkan profil toko" description="Lengkapi informasi dasar agar pelanggan bisa menemukan toko kamu."/>
    <Panel className="setup-panel">
      <form onSubmit={(event) => void save(event)}>
        <div className="setup-intro">
          <span><Store size={22}/></span>
          <div><strong>Selamat datang di SaveBite</strong><small>Profil toko bisa diperbarui kapan saja.</small></div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="store-name">Nama toko</label>
            <input id="store-name" value={form.store_name} onChange={(event) => setForm({ ...form, store_name: event.target.value })} required maxLength={MAX_STORE_NAME}/>
          </div>
          <div className="field">
            <label htmlFor="store-category">Kategori</label>
            <select id="store-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {CATEGORIES.map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
          <div className="field wide">
            <label htmlFor="store-description">Deskripsi</label>
            <textarea id="store-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={MAX_DESCRIPTION} placeholder="Ceritakan sedikit tentang toko kamu."/>
          </div>
          <div className="field wide">
            <label htmlFor="store-address">Alamat</label>
            <input id="store-address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} required maxLength={MAX_ADDRESS} placeholder="Alamat lengkap toko"/>
          </div>
          <div className="field">
            <label htmlFor="store-open">Jam buka</label>
            <input id="store-open" value={form.open_time} onChange={(event) => setForm({ ...form, open_time: event.target.value })} placeholder="08.00" maxLength={20}/>
          </div>
          <div className="field">
            <label htmlFor="store-close">Jam tutup</label>
            <input id="store-close" value={form.close_time} onChange={(event) => setForm({ ...form, close_time: event.target.value })} placeholder="21.00" maxLength={20}/>
          </div>
          <div className="field">
            <label htmlFor="store-lat">Latitude</label>
            <input id="store-lat" value={form.lat} onChange={(event) => setForm({ ...form, lat: event.target.value })} placeholder="-6.2000" inputMode="decimal"/>
            <small>Isi latitude dan longitude agar toko muncul di peta.</small>
          </div>
          <div className="field">
            <label htmlFor="store-lng">Longitude</label>
            <input id="store-lng" value={form.lng} onChange={(event) => setForm({ ...form, lng: event.target.value })} placeholder="106.8167" inputMode="decimal"/>
          </div>
        </div>
        <button type="button" className="button button-secondary" disabled={locating} onClick={() => void locate()}>
          <MapPin size={14}/>{locating ? "Mencari lokasi…" : "Gunakan lokasi saya"}
        </button>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="form-submit-row">
          <button className="button button-primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan dan lanjutkan"}</button>
        </div>
      </form>
    </Panel>
  </>;
}
