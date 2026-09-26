"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus } from "lucide-react";
import Link from "next/link";
import {
  PageHeading,
  Panel,
  describeError,
  parseRupiahAmount,
  requiredText,
  storageObjectPath,
  useAsyncData,
  validateImageFile,
  verifyImageSignature,
} from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import type { MerchantBag } from "./MerchantData";

/** Local-timezone YYYY-MM-DD, so the date input is never off by a day. */
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** `datetime-local` wants a local timestamp, not UTC. */
const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const BAG_BUCKET = "bag-images";
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 1000;

type FormState = {
  title: string;
  description: string;
  contents: string;
  original_price: string;
  sale_price: string;
  quantity_total: string;
  pickup_window: string;
  available_on: string;
  pickup_start_at: string;
  pickup_end_at: string;
  image_url: string;
};

const emptyForm: FormState = {
  title: "",
  description: "",
  contents: "",
  original_price: "",
  sale_price: "",
  quantity_total: "1",
  pickup_window: "16.00–19.00",
  available_on: today(),
  pickup_start_at: "",
  pickup_end_at: "",
  image_url: "",
};

export default function BagForm({ edit = false }: { edit?: boolean }) {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const id = edit ? params.id : undefined;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [merchantId, setMerchantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async (): Promise<{ merchantId: string; bag: MerchantBag | null }> => {
    const db = supabaseBrowser();
    const { data, error: rpcError } = await db.rpc("get_my_merchant");
    if (rpcError) throw rpcError;
    const merchant = (data ?? null) as Record<string, unknown> | null;
    const resolvedMerchantId = String(merchant?.id ?? "");

    let bag: MerchantBag | null = null;
    if (id) {
      const { data: row, error: bagError } = await db.from("surprise_bags").select("*").eq("id", id).maybeSingle();
      if (bagError) throw bagError;
      bag = (row ?? null) as MerchantBag | null;
      if (!bag) throw new Error("Bag tidak ditemukan.");
    }
    return { merchantId: resolvedMerchantId, bag };
  };

  const { data, loading, error: loadError, reload } = useAsyncData(load, {
    deps: [id],
    scope: "bagForm.load",
    initialData: { merchantId: "", bag: null },
  });

  // Hydrate the form exactly once per target, from the loaded row. Re-running on
  // every load would discard whatever the merchant is currently typing.
  const hydratedKey = useRef<string | null>(null);
  useEffect(() => {
    if (loading || loadError) return;
    const key = id ?? "new";
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;

    if (data.merchantId) setMerchantId(data.merchantId);
    const bag = data.bag;
    if (!bag) return;
    setForm({
      title: bag.title,
      description: bag.description ?? "",
      contents: (bag.contents ?? []).join(", "),
      original_price: String(bag.original_price),
      sale_price: String(bag.sale_price),
      quantity_total: String(bag.quantity_total),
      pickup_window: bag.pickup_window ?? "",
      available_on: bag.available_on ?? today(),
      pickup_start_at: toLocalInput(bag.pickup_start_at ?? ""),
      pickup_end_at: toLocalInput(bag.pickup_end_at ?? ""),
      image_url: bag.image_url ?? "",
    });
  }, [loading, loadError, id, data]);

  if (loading && !id) return <div className="loading-screen" aria-busy="true"><span className="spinner"/>Menyiapkan form…</div>;
  if (loadError) {
    return <Panel><div className="alert alert-error" role="alert">{loadError} <button className="text-link" onClick={reload}>Coba lagi</button></div></Panel>;
  }
  if (edit && !id) return <Panel><div className="alert alert-error" role="alert">Bag tidak ditemukan.</div></Panel>;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");

    try {
      const db = supabaseBrowser();

      const title = requiredText(form.title, MAX_TITLE);
      if (!title) throw new Error("Nama bag wajib diisi.");
      const originalPrice = parseRupiahAmount(form.original_price);
      const salePrice = parseRupiahAmount(form.sale_price);
      if (originalPrice === null || salePrice === null) throw new Error("Harga harus berupa angka lebih dari nol.");
      if (salePrice > originalPrice) throw new Error("Harga SaveBite tidak boleh lebih tinggi dari harga normal.");
      const quantity = Number(form.quantity_total);
      if (!Number.isInteger(quantity) || quantity < (edit ? 0 : 1) || quantity > 1000) {
        throw new Error("Jumlah bag harus antara 0 dan 1000.");
      }
      if (!requiredText(form.pickup_window, 40)) throw new Error("Waktu pickup wajib diisi.");
      if (!form.available_on) throw new Error("Tanggal tersedia wajib diisi.");

      const startIso = form.pickup_start_at ? new Date(form.pickup_start_at).toISOString() : null;
      const endIso = form.pickup_end_at ? new Date(form.pickup_end_at).toISOString() : null;
      if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
        throw new Error("Waktu pickup berakhir harus setelah waktu mulai.");
      }

      // Validate the bytes, not just the extension: these buckets are public.
      let imageUrl = form.image_url || null;
      if (image) {
        const shallow = validateImageFile(image);
        if (!shallow.ok) throw new Error(shallow.error);
        const verified = await verifyImageSignature(image);
        if (!verified.ok) throw new Error(verified.error);

        const { data: auth } = await db.auth.getUser();
        const ownerId = auth.user?.id ?? "";
        if (!ownerId) throw new Error("Sesi kamu sudah berakhir. Silakan masuk kembali.");

        const path = storageObjectPath(ownerId, image, "bag");
        const { error: uploadError } = await db.storage.from(BAG_BUCKET).upload(path, image, {
          upsert: false,
          contentType: verified.type,
          cacheControl: "31536000",
        });
        if (uploadError) throw uploadError;
        imageUrl = db.storage.from(BAG_BUCKET).getPublicUrl(path).data.publicUrl;
      }

      const payload = {
        title,
        description: requiredText(form.description, MAX_DESCRIPTION) ?? "",
        contents: form.contents.split(",").map((value) => value.trim()).filter(Boolean),
        original_price: originalPrice,
        sale_price: salePrice,
        quantity_total: quantity,
        pickup_window: form.pickup_window.trim(),
        available_on: form.available_on,
        pickup_start_at: startIso,
        pickup_end_at: endIso,
        image_url: imageUrl,
      };

      if (edit && id) {
        // Edit goes through a definer function that enforces ownership and
        // quantity invariants server-side; create relies on the RLS policy.
        const { error: rpcError } = await db.rpc("update_surprise_bag", {
          p_bag_id: id,
          p_title: payload.title,
          p_description: payload.description,
          p_original_price: payload.original_price,
          p_sale_price: payload.sale_price,
          p_quantity_total: payload.quantity_total,
          p_pickup_window: payload.pickup_window,
          p_image_url: payload.image_url,
          p_available_on: payload.available_on,
          p_pickup_start_at: payload.pickup_start_at,
          p_pickup_end_at: payload.pickup_end_at,
          p_contents: payload.contents,
        });
        if (rpcError) throw rpcError;
      } else {
        if (!merchantId) throw new Error("Toko belum siap. Muat ulang halaman.");
        const { error: insertError } = await db.from("surprise_bags").insert({
          ...payload,
          merchant_id: merchantId,
          quantity_left: quantity,
          status: "active",
        });
        if (insertError) throw insertError;
      }

      router.push("/merchant/bags");
    } catch (caught) {
      setError(describeError(caught, edit ? "bagForm.update" : "bagForm.create", { bagId: id }));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Link href="/merchant/bags" className="back-link"><ArrowLeft size={15}/>Kembali ke surprise bag</Link>
    <PageHeading
      eyebrow={edit ? "EDIT KATALOG" : "KATALOG SAVEBITE"}
      title={edit ? "Perbarui surprise bag" : "Tambah surprise bag"}
      description="Informasi bag akan tampil di katalog konsumen."
    />
    <Panel className="bag-form-panel">
      <form onSubmit={(event) => void save(event)}>
        <div className="form-grid">
          <div className="field wide">
            <label htmlFor="bag-title">Nama bag</label>
            <input id="bag-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required maxLength={MAX_TITLE} placeholder="Contoh: Bakery Surprise Box"/>
          </div>
          <div className="field wide">
            <label htmlFor="bag-description">Deskripsi</label>
            <textarea id="bag-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={MAX_DESCRIPTION} placeholder="Jelaskan jenis makanan di dalam bag."/>
          </div>
          <div className="field wide">
            <label htmlFor="bag-contents">Isi bag (pisahkan dengan koma)</label>
            <input id="bag-contents" value={form.contents} onChange={(event) => setForm({ ...form, contents: event.target.value })} placeholder="Roti sourdough, pastry, cookies"/>
          </div>
          <div className="field">
            <label htmlFor="bag-original-price">Harga normal (Rp)</label>
            <input id="bag-original-price" type="number" inputMode="numeric" min="1" step="1" value={form.original_price} onChange={(event) => setForm({ ...form, original_price: event.target.value })} required/>
          </div>
          <div className="field">
            <label htmlFor="bag-sale-price">Harga SaveBite (Rp)</label>
            <input id="bag-sale-price" type="number" inputMode="numeric" min="1" step="1" value={form.sale_price} onChange={(event) => setForm({ ...form, sale_price: event.target.value })} required/>
          </div>
          <div className="field">
            <label htmlFor="bag-quantity">Jumlah bag</label>
            <input id="bag-quantity" type="number" inputMode="numeric" min={edit ? "0" : "1"} max="1000" step="1" value={form.quantity_total} onChange={(event) => setForm({ ...form, quantity_total: event.target.value })} required/>
          </div>
          <div className="field">
            <label htmlFor="bag-window">Waktu pickup</label>
            <input id="bag-window" value={form.pickup_window} onChange={(event) => setForm({ ...form, pickup_window: event.target.value })} placeholder="16.00–19.00" required maxLength={40}/>
          </div>
          <div className="field">
            <label htmlFor="bag-available-on">Tanggal tersedia</label>
            <input id="bag-available-on" type="date" value={form.available_on} onChange={(event) => setForm({ ...form, available_on: event.target.value })} required/>
          </div>
          <div className="field">
            <label htmlFor="bag-start">Pickup mulai</label>
            <input id="bag-start" type="datetime-local" value={form.pickup_start_at} onChange={(event) => setForm({ ...form, pickup_start_at: event.target.value })}/>
          </div>
          <div className="field">
            <label htmlFor="bag-end">Pickup berakhir</label>
            <input id="bag-end" type="datetime-local" value={form.pickup_end_at} onChange={(event) => setForm({ ...form, pickup_end_at: event.target.value })}/>
          </div>
          <div className="field wide">
            <label htmlFor="bag-image">Foto bag</label>
            <label className="image-picker" htmlFor="bag-image">
              <ImagePlus size={20}/>
              <span>{image?.name || "Unggah JPG, PNG, atau WebP (maks. 5 MB)"}</span>
              <input
                ref={fileInput}
                id="bag-image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setImage(event.target.files?.[0] ?? null)}
              />
            </label>
            {form.image_url && <img className="bag-preview" src={form.image_url} alt="Foto bag saat ini" width={190} height={130} loading="lazy" decoding="async" referrerPolicy="no-referrer"/>}
          </div>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="form-submit-row">
          <button className="button button-primary" disabled={busy}>{busy ? "Menyimpan…" : edit ? "Simpan perubahan" : "Terbitkan bag"}</button>
        </div>
      </form>
    </Panel>
  </>;
}
