"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { EmptyState, SmartImage, describeError, useAsyncData, useAuth } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { makeIdempotencyKey, rupiah } from "@savebite/web-shared";
import { loadMidtransSnap } from "@savebite/web-shared/snap";
import type { BagRow } from "../../../components/types";

type CheckoutOrder = {
  id?: string;
  order_id?: string;
  status?: string;
  payment_snap_token?: string;
  payment_expires_at?: string;
  total_amount?: number;
  order_reference?: string;
};

/** Snap is redirected to the order list after a short confirmation beat. */
const REDIRECT_DELAY_MS = 1300;

export default function CheckoutPage() {
  const { bagId } = useParams<{ bagId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  const requestedQty = Math.max(1, Math.min(20, Number(params.get("qty") || 1) || 1));
  const [qty, setQty] = useState(requestedQty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Every scheduled navigation is tracked so unmounting mid-flow cannot fire a
  // router.push against a dead tree.
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  const redirectToOrders = (message?: string) => {
    if (message) setMessage(message);
    timers.current.push(setTimeout(() => router.push("/orders"), REDIRECT_DELAY_MS));
  };

  const { data: bag, loading, error: loadError, reload } = useAsyncData<BagRow | null>(
    async () => {
      const { data, error: queryError } = await supabaseBrowser()
        .from("available_bags")
        .select("*")
        .eq("id", bagId)
        .maybeSingle();
      if (queryError) throw queryError;
      return (data as BagRow | null) ?? null;
    },
    { deps: [bagId], scope: "checkout.loadBag", initialData: null },
  );

  async function refreshStatus(orderId: string) {
    if (!orderId) {
      redirectToOrders("Status pembayaran sudah diperbarui.");
      return;
    }
    const { error: statusError } = await supabaseBrowser().functions.invoke("midtrans-status", {
      body: { order_id: orderId },
    });
    redirectToOrders(
      statusError
        ? "Pembayaran diproses. Status akan diperbarui pada halaman pesanan."
        : "Status pembayaran sudah diperbarui.",
    );
  }

  async function pay() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/checkout/${bagId}?qty=${qty}`)}`);
      return;
    }
    if (!bag) return;

    // `busy` is the real double-submit guard. The idempotency key only protects
    // against a retry of this single invocation, so the button must be disabled
    // synchronously before any await.
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const { data, error: invokeError } = await supabaseBrowser().functions.invoke("midtrans-create", {
        body: {
          bag_id: bag.id,
          quantity: qty,
          payment_method: "QRIS",
          idempotency_key: makeIdempotencyKey(),
        },
      });
      if (invokeError) throw invokeError;

      const order = (data?.order ?? {}) as CheckoutOrder;
      const orderId = order.id ?? order.order_id ?? "";
      const token = order.payment_snap_token;

      if (!token) {
        redirectToOrders("Pesanan sudah tercatat. Lanjutkan pembayaran dari halaman pesanan.");
        return;
      }

      await loadMidtransSnap();
      window.snap?.pay(token, {
        onSuccess: () => void refreshStatus(orderId),
        onPending: () => void refreshStatus(orderId),
        onError: () => void refreshStatus(orderId),
        onClose: () => void refreshStatus(orderId),
      });
      setMessage("Selesaikan pembayaran QRIS pada jendela Midtrans.");
    } catch (caught) {
      setError(describeError(caught, "checkout.pay", { bagId: bag.id, quantity: qty }));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !bag) {
    return <div className="loading-screen" aria-busy="true"><span className="spinner"/>Menyiapkan checkout…</div>;
  }

  if (loadError) {
    return (
      <EmptyState
        title="Checkout tidak dapat dimuat"
        detail={loadError}
        action={<button className="button button-primary" onClick={reload}>Coba lagi</button>}
      />
    );
  }

  if (!bag) {
    return <EmptyState title="Bag tidak tersedia" detail="Bag ini mungkin sudah habis atau tidak lagi dipublikasikan." action={<Link href="/" className="button button-primary">Kembali ke katalog</Link>}/>;
  }

  // Never let the shopper order more than the remaining stock, even if the URL
  // asked for it: the server re-checks, but the UI should not invite the attempt.
  const safeQty = Math.min(qty, Math.max(1, bag.quantity_left));
  const outOfStock = bag.quantity_left <= 0;

  return <>
    <Link href={"/bags/" + bag.id} className="back-link"><ArrowLeft size={15}/>Kembali ke detail</Link>
    <PageHeadingBlock />
    <div className="checkout-layout">
      <section className="panel checkout-summary">
        <h2>Ringkasan pesanan</h2>
        <div className="checkout-bag">
          {bag.image_url ? <SmartImage src={bag.image_url} alt={bag.title} /> : <div role="img" aria-label="Gambar bag belum tersedia">🥐</div>}
          <span><strong>{bag.title}</strong><small>{bag.merchant_name} · {bag.pickup_window}</small></span>
        </div>
        <div className="qty-control">
          <span>Jumlah bag</span>
          <div>
            <button type="button" disabled={safeQty <= 1} onClick={() => setQty(safeQty - 1)} aria-label="Kurangi jumlah">-</button>
            <b>{safeQty}</b>
            <button type="button" disabled={safeQty >= bag.quantity_left} onClick={() => setQty(safeQty + 1)} aria-label="Tambah jumlah">+</button>
          </div>
        </div>
        <div className="checkout-line"><span>Harga bag</span><b>{rupiah(bag.sale_price)} × {safeQty}</b></div>
        <div className="checkout-line"><span>Biaya layanan</span><b>Ditampilkan saat checkout</b></div>
        <div className="checkout-total"><span>Subtotal bag</span><strong>{rupiah(bag.sale_price * safeQty)}</strong></div>
        <div className="pickup-info"><ShieldCheck size={17}/><span>Pastikan kamu dapat mengambil pesanan selama waktu pickup toko.</span></div>
        <button className="button button-primary checkout-pay" disabled={busy || outOfStock} onClick={() => void pay()}>
          <LockKeyhole size={16}/>{busy ? "Menyiapkan pembayaran…" : outOfStock ? "Stok habis" : "Bayar dengan QRIS"}
        </button>
        {message && <div className="alert alert-success" role="status">{message}</div>}
        {error && <div className="alert alert-error" role="alert">{error}</div>}
      </section>
      <aside className="checkout-aside">
        <div className="secure-illustration" aria-hidden="true">✓</div>
        <h3>Transaksi terlindungi</h3>
        <p>Status pembayaran dikonfirmasi server Midtrans. Simpan QR pickup dari halaman pesanan setelah toko menyiapkan bag.</p>
        <small>Jangan menutup jendela pembayaran sebelum status diperbarui.</small>
      </aside>
    </div>
  </>;
}

function PageHeadingBlock() {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">CHECKOUT AMAN</div>
        <h1>Pesanan kamu</h1>
        <p>Pembayaran QRIS diproses secara aman melalui Midtrans.</p>
      </div>
    </div>
  );
}
