"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Clock3, QrCode, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  EmptyState,
  PageHeading,
  Panel,
  SmartImage,
  StatusPill,
  describeError,
  useAsyncData,
  useAuth,
  useRealtime,
} from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah, shortDate } from "@savebite/web-shared";
import { loadMidtransSnap } from "@savebite/web-shared/snap";

type OrderRow = {
  id: string;
  order_reference: string;
  status: string;
  created_at: string;
  total_amount: number;
  quantity: number;
  bag_title: string;
  bag_image_url?: string;
  merchant_name: string;
  pickup_window_snapshot?: string;
  payment_snap_token?: string;
  pickup_start_at?: string;
  pickup_end_at?: string;
  reviewed?: boolean;
};

const ACTIVE_STATUSES = ["pending", "paid", "preparing", "ready"];

/** Bounded so a long-lived account cannot pull an unbounded table. */
const MAX_ORDERS = 100;

export default function OrdersPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"active" | "history">("active");
  const [codes, setCodes] = useState<Record<string, { value: string; expiresAt: number }>>({});
  const [qrTokens, setQrTokens] = useState<Record<string, string>>({});
  const [working, setWorking] = useState("");
  const [actionError, setActionError] = useState("");

  const load = async (): Promise<OrderRow[]> => {
    if (!user) return [];
    const { data, error } = await supabaseBrowser()
      .from("consumer_orders")
      .select("*")
      .eq("consumer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_ORDERS);
    if (error) throw error;
    return (data ?? []) as OrderRow[];
  };

  const { data: orders, loading, error, reload } = useAsyncData<OrderRow[]>(load, {
    // No session means nothing to load; the page renders a sign-in prompt.
    enabled: Boolean(user),
    deps: [user?.id],
    scope: "orders.load",
    initialData: [],
  });

  // Realtime keeps the list live. The debounce inside `useRealtime` coalesces
  // the burst of events a single redemption produces into one refetch.
  useRealtime(
    "consumer-orders-live",
    { table: "orders", filter: user ? `consumer_id=eq.${user.id}` : undefined },
    reload,
  );

  // A manual pickup code is only valid for five minutes on the server. Clearing
  // it locally at the same moment stops a shopper from showing a merchant a
  // code that is guaranteed to be rejected.
  useEffect(() => {
    const now = Date.now();
    const stale = Object.entries(codes).filter(([, entry]) => entry.expiresAt <= now);
    if (stale.length) {
      setCodes((current) => {
        const next = { ...current };
        for (const [orderId] of stale) delete next[orderId];
        return next;
      });
    }
    const soonest = Object.values(codes).map((entry) => entry.expiresAt - now).filter((ms) => ms > 0);
    if (!soonest.length) return;
    const timer = setTimeout(() => setCodes((current) => ({ ...current })), Math.min(...soonest));
    return () => clearTimeout(timer);
  }, [codes]);

  async function runAction(orderId: string, action: () => Promise<void>) {
    if (working) return;
    setWorking(orderId);
    setActionError("");
    try {
      await action();
    } catch (caught) {
      setActionError(describeError(caught, "orders.action", { orderId }));
    } finally {
      setWorking("");
    }
  }

  const makeCode = (order: OrderRow) =>
    runAction(order.id, async () => {
      const { data, error: rpcError } = await supabaseBrowser().rpc("issue_pickup_manual_code", {
        p_order_id: order.id,
      });
      if (rpcError) throw rpcError;
      const code = String(data?.code ?? "");
      if (!code) throw new Error("Kode pickup belum dapat dibuat. Coba lagi.");
      // Mirror the server's five-minute cap; the server is authoritative.
      const expiresAt = Date.now() + 5 * 60_000;
      setCodes((current) => ({ ...current, [order.id]: { value: code, expiresAt } }));
    });

  const makeQr = (order: OrderRow) =>
    runAction(order.id, async () => {
      const { data, error: rpcError } = await supabaseBrowser().rpc("issue_pickup_token", {
        p_order_id: order.id,
      });
      if (rpcError) throw rpcError;
      const token = String(data?.pickup_code ?? "");
      if (!token) throw new Error("QR pickup belum dapat dibuat. Coba lagi.");
      setQrTokens((current) => ({ ...current, [order.id]: token }));
    });

  const pay = (order: OrderRow) =>
    runAction(order.id, async () => {
      let token = order.payment_snap_token;
      if (!token) {
        const { data, error: invokeError } = await supabaseBrowser().functions.invoke("midtrans-status", {
          body: { order_id: order.id },
        });
        if (invokeError) throw invokeError;
        token = data?.order?.payment_snap_token;
      }
      if (!token) throw new Error("Tautan pembayaran sudah tidak tersedia.");
      await loadMidtransSnap();
      window.snap?.pay(token, {
        onSuccess: () => reload(),
        onPending: () => reload(),
        onError: () => reload(),
        onClose: () => reload(),
      });
    });

  if (!user) {
    return (
      <EmptyState
        title="Masuk untuk melihat pesanan"
        detail="Pesanan, pembayaran dan kode pickup kamu muncul di sini."
        action={<Link href="/login" className="button button-primary">Masuk ke SaveBite</Link>}
      />
    );
  }

  const active = orders.filter((order) => ACTIVE_STATUSES.includes(order.status));
  const history = orders.filter((order) => !ACTIVE_STATUSES.includes(order.status));
  const visible = tab === "active" ? active : history;

  return <>
    <PageHeading
      eyebrow="RINGKASAN AKTIVITAS"
      title="Pesanan kamu"
      description="Pantau pembayaran dan siapkan pickup bag dari toko."
      action={<button className="button button-secondary" onClick={reload}><RefreshCw size={14}/>Muat ulang</button>}
    />
    <div className="tab-row" role="tablist">
      <button role="tab" aria-selected={tab === "active"} className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>Berjalan <b>{active.length}</b></button>
      <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Riwayat <b>{history.length}</b></button>
    </div>
    {error && <div className="alert alert-error" role="alert">{error} <button className="text-link" onClick={reload}>Coba lagi</button></div>}
    {actionError && <div className="alert alert-error" role="alert">{actionError}</div>}
    {loading && !orders.length ? (
      <div className="loading-screen" aria-busy="true"><span className="spinner"/>Memuat pesanan…</div>
    ) : visible.length ? (
      <Panel className="orders-panel">
        <div className="consumer-orders">
          {visible.map((order) => (
            <article className="consumer-order" key={order.id}>
              <div className="consumer-order-top">
                <div>
                  {order.bag_image_url
                    ? <SmartImage src={order.bag_image_url} alt={order.bag_title} className="order-thumb" />
                    : <div className="order-thumb order-placeholder" role="img" aria-label="Gambar tidak tersedia">🥐</div>}
                  <div>
                    <h3>{order.bag_title}</h3>
                    <p>{order.merchant_name} · {order.quantity} bag · {shortDate(order.created_at)}</p>
                    <small>#{order.order_reference}</small>
                  </div>
                </div>
                <StatusPill status={order.status}/>
              </div>
              <div className="consumer-order-bottom">
                <div><span>Total</span><strong>{rupiah(order.total_amount)}</strong></div>
                <div className="order-actions">
                  {order.status === "pending" && (
                    <button className="button button-primary" disabled={Boolean(working)} onClick={() => void pay(order)}>
                      {working === order.id ? "Membuka…" : "Lanjut bayar"}
                    </button>
                  )}
                  {order.status === "ready" && (
                    <>
                      <button className="button button-primary" disabled={Boolean(working)} onClick={() => void makeCode(order)}>
                        <QrCode size={14}/>{codes[order.id] ? "Terbitkan ulang kode" : working === order.id ? "Membuat kode…" : "Tampilkan kode pickup"}
                      </button>
                      <button className="button button-secondary" disabled={Boolean(working)} onClick={() => void makeQr(order)}>
                        <QrCode size={14}/>QR Flutter
                      </button>
                    </>
                  )}
                  {order.status === "redeemed" && !order.reviewed && (
                    <Link className="button button-secondary" href={"/reviews/" + order.id}>Beri ulasan</Link>
                  )}
                  {order.status === "redeemed" && order.reviewed && <span className="review-done">✓ Ulasan terkirim</span>}
                </div>
              </div>
              {codes[order.id] && (
                <div className="manual-code-box">
                  <div>
                    <span>KODE PICKUP · MAKS. 5 MENIT</span>
                    <strong>{codes[order.id].value}</strong>
                    <small><Clock3 size={12}/>Tunjukkan kode ini kepada merchant.</small>
                  </div>
                  <button className="button button-quiet" onClick={() => setCodes((current) => omit(current, order.id))}>Tutup</button>
                </div>
              )}
              {qrTokens[order.id] && (
                <div className="manual-code-box qr-token-box">
                  <div className="qr-box">
                    <QRCodeSVG value={qrTokens[order.id]} size={152}/>
                    <small>QR tetap kompatibel dengan aplikasi Flutter.</small>
                  </div>
                  <button className="button button-quiet" onClick={() => setQrTokens((current) => omit(current, order.id))}>Tutup</button>
                </div>
              )}
              {order.status === "ready" && (
                <div className="pickup-timing">
                  Pickup: {order.pickup_window_snapshot || "ikuti jam toko"}
                  {order.pickup_start_at && order.pickup_end_at
                    ? ` · ${shortDate(order.pickup_start_at)} – ${shortDate(order.pickup_end_at)}`
                    : ""}
                </div>
              )}
            </article>
          ))}
        </div>
      </Panel>
    ) : (
      <EmptyState
        title={tab === "active" ? "Belum ada pesanan berjalan" : "Belum ada riwayat pesanan"}
        detail={tab === "active" ? "Saatnya menemukan surprise bag untuk diselamatkan." : "Pesanan yang selesai akan tersimpan di sini."}
        action={<Link href="/" className="button button-primary">Jelajahi surprise bag</Link>}
      />
    )}
  </>;
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
