"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Clock3, RefreshCw, X } from "lucide-react";
import { EmptyState, PageHeading, Panel, SmartImage, StatusPill, describeError, useAsyncData, useRealtime } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah, shortDate } from "@savebite/web-shared";
import type { MerchantOrder } from "../../../components/MerchantData";

/** Bounded so a busy store cannot pull an unbounded order table. */
const MAX_ORDERS = 200;

const FILTERS = [
  ["all", "Semua"],
  ["pending", "Menunggu"],
  ["paid", "Dibayar"],
  ["ready", "Siap pickup"],
  ["redeemed", "Selesai"],
] as const;

export default function OrdersPage() {
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");

  const { data: orders, loading, error, reload } = useAsyncData<MerchantOrder[]>(
    async () => {
      const { data, error: queryError } = await supabaseBrowser()
        .from("merchant_orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(MAX_ORDERS);
      if (queryError) throw queryError;
      return (data ?? []) as MerchantOrder[];
    },
    { scope: "merchantOrders.load", initialData: [] },
  );

  // Unfiltered on purpose: Supabase Realtime applies the caller's RLS, and a
  // per-merchant filter column would require denormalising it onto `orders`.
  // `useRealtime` debounces the resulting burst into a single refetch.
  useRealtime("merchant-orders-page", { table: "orders", debounceMs: 500 }, reload);

  async function run(orderId: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(orderId);
    setActionError("");
    try {
      await action();
      reload();
    } catch (caught) {
      setActionError(describeError(caught, "merchantOrders.action", { orderId }));
    } finally {
      setBusy("");
    }
  }

  const markReady = (order: MerchantOrder) =>
    run(order.id, async () => {
      const { error: rpcError } = await supabaseBrowser().rpc("mark_order_ready", { p_order_id: order.id });
      if (rpcError) throw rpcError;
    });

  const cancel = (order: MerchantOrder) => {
    if (!window.confirm("Batalkan pesanan ini melalui Midtrans?")) return;
    void run(order.id, async () => {
      const { error: invokeError } = await supabaseBrowser().functions.invoke("midtrans-cancel", {
        body: { order_id: order.id },
      });
      if (invokeError) throw invokeError;
    });
  };

  const visible = filter === "all" ? orders : orders.filter((order) => order.status === filter);

  return <>
    <PageHeading
      eyebrow="OPERASIONAL TOKO"
      title="Pesanan masuk"
      description="Perubahan status pembayaran tampil otomatis."
      action={<button className="button button-secondary" onClick={reload}><RefreshCw size={14}/>Muat ulang</button>}
    />
    <div className="tab-row" role="tablist">
      {FILTERS.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
          {label}
        </button>
      ))}
    </div>
    {error && <div className="alert alert-error" role="alert">{error} <button className="text-link" onClick={reload}>Coba lagi</button></div>}
    {actionError && <div className="alert alert-error" role="alert">{actionError}</div>}
    {loading && !orders.length ? (
      <div className="loading-screen" aria-busy="true"><span className="spinner"/>Memuat pesanan…</div>
    ) : visible.length ? (
      <Panel className="merchant-orders-panel">
        <div className="merchant-order-list">
          {visible.map((order) => (
            <article className="merchant-order-row" key={order.id}>
              {order.bag_image_url
                ? <SmartImage src={order.bag_image_url} alt={order.bag_title} />
                : <div className="merchant-order-placeholder" role="img" aria-label="Gambar tidak tersedia">🥐</div>}
              <div className="merchant-order-main">
                <div className="merchant-order-header">
                  <div>
                    <h3>{order.bag_title}</h3>
                    <p>{order.consumer_anonymized ? "Pelanggan" : order.consumer_name || "Pelanggan"} · {order.quantity} bag · #{order.order_reference}</p>
                  </div>
                  <StatusPill status={order.status}/>
                </div>
                <div className="merchant-order-meta">
                  <span><Clock3 size={12}/>{shortDate(order.created_at)}</span>
                  <strong>{rupiah(order.total_amount)}</strong>
                  <span>Net {rupiah(order.merchant_net_amount)}</span>
                </div>
                <div className="merchant-order-footer">
                  {(order.status === "paid" || order.status === "preparing") && (
                    <button className="button button-primary" disabled={Boolean(busy)} onClick={() => void markReady(order)}>
                      <Check size={14}/>{busy === order.id ? "Memproses…" : "Tandai siap pickup"}
                    </button>
                  )}
                  {order.status === "ready" && (
                    <Link className="button button-secondary" href="/merchant/redeem">Buka redeem pickup</Link>
                  )}
                  {order.status === "pending" && (
                    <button className="button button-terra" disabled={Boolean(busy)} onClick={() => cancel(order)}>
                      <X size={14}/>Batalkan
                    </button>
                  )}
                  {order.status === "ready" && order.pickup_end_at && (
                    <small>Waktu pickup sampai {shortDate(order.pickup_end_at)}</small>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    ) : (
      <EmptyState
        title="Belum ada pesanan di sini"
        detail={filter === "all" ? "Pesanan konsumen akan tampil otomatis setelah checkout." : "Tidak ada pesanan pada filter ini."}
        action={filter === "all" ? undefined : <button className="button button-secondary" onClick={() => setFilter("all")}>Lihat semua</button>}
      />
    )}
  </>;
}
