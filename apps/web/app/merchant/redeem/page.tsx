"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, ScanLine } from "lucide-react";
import { EmptyState, PageHeading, Panel, StatusPill, describeError, useAsyncData, useRealtime } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah } from "@savebite/web-shared";
import type { MerchantOrder } from "../../../components/MerchantData";

/**
 * The Flutter app still presents a 52-character `SB2_` token, so both formats
 * are accepted on the same counter. Anything else is treated as an 8-digit code.
 */
const QR_TOKEN = /^SB2_[0-9A-Fa-f]{48}$/;
const MAX_CODE_LENGTH = 52;

const MAX_READY_ORDERS = 25;

type Redeemed = {
  order_id: string;
  order_reference: string;
  customer_name: string;
  bag_title: string;
  quantity: number;
  redeemed_at: string;
  merchant_net_amount: number;
};

export default function RedeemPage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<Redeemed | null>(null);

  const { data: orders, loading, reload } = useAsyncData<MerchantOrder[]>(
    async () => {
      const { data, error: queryError } = await supabaseBrowser()
        .from("merchant_orders")
        .select("*")
        .eq("status", "ready")
        .order("ready_at", { ascending: true })
        .limit(MAX_READY_ORDERS);
      if (queryError) throw queryError;
      return (data ?? []) as MerchantOrder[];
    },
    { scope: "merchantRedeem.readyOrders", initialData: [] },
  );

  useRealtime("ready-orders-redeem", { table: "orders", debounceMs: 500 }, reload);

  function onChange(value: string) {
    setError("");
    setCode(
      value.trim().startsWith("SB2_")
        ? value.replace(/\s/g, "").slice(0, MAX_CODE_LENGTH)
        : value.replace(/\D/g, "").slice(0, 8),
    );
  }

  async function redeem(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = code.trim();
    if (QR_TOKEN.test(trimmed) ? trimmed.length < MAX_CODE_LENGTH : trimmed.length !== 8) {
      setError("Kode pickup harus 8 angka, atau QR Flutter dengan token SB2_.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess(null);

    try {
      const db = supabaseBrowser();
      const { data, error: rpcError } = QR_TOKEN.test(trimmed)
        ? await db.rpc("redeem_order", { p_code: trimmed })
        : await db.rpc("redeem_manual_pickup_code", { p_code: trimmed });
      if (rpcError) throw rpcError;

      const payload = (data ?? {}) as Record<string, unknown>;
      if (payload.ok === false) {
        throw new Error(String(payload.message ?? "Kode tidak valid atau sudah kedaluwarsa."));
      }
      if (!payload.order_id) throw new Error("Kode tidak valid atau sudah kedaluwarsa.");

      setSuccess({
        order_id: String(payload.order_id),
        order_reference: String(payload.order_reference ?? ""),
        customer_name: String(payload.customer_name ?? "Pelanggan"),
        bag_title: String(payload.bag_title ?? "Surprise bag"),
        quantity: Number(payload.quantity ?? 1),
        redeemed_at: String(payload.redeemed_at ?? new Date().toISOString()),
        merchant_net_amount: Number(payload.merchant_net_amount ?? 0),
      });
      setCode("");
      reload();
    } catch (caught) {
      setError(describeError(caught, "merchantRedeem.verify", { format: QR_TOKEN.test(trimmed) ? "qr" : "code" }));
    } finally {
      setBusy(false);
    }
  }

  const complete = QR_TOKEN.test(code.trim()) ? code.trim().length >= MAX_CODE_LENGTH : code.length === 8;

  return <>
    <PageHeading
      eyebrow="PICKUP COUNTER"
      title="Redeem pesanan"
      description="Masukkan kode 8 digit pelanggan atau pindai QR dari aplikasi SaveBite."
    />
    <div className="redeem-layout">
      <Panel className="redeem-panel">
        <div className="redeem-icon"><ScanLine size={23}/></div>
        <h2>Verifikasi pickup</h2>
        <p>Masukkan 8 digit kode. QR Flutter dengan token 52 karakter juga tetap didukung.</p>
        <form onSubmit={(event) => void redeem(event)}>
          <div className="field">
            <label htmlFor="pickup-code">Kode pickup</label>
            <input
              id="pickup-code"
              className="pickup-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={MAX_CODE_LENGTH}
              value={code}
              onChange={(event) => onChange(event.target.value)}
              placeholder="00000000"
              // A pickup counter should be ready to type into on arrival.
              autoFocus
            />
            <span className="redeem-scan-hint">Pindai QR dengan kamera atau ketik kode secara manual.</span>
          </div>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {success && (
            <div className="redeem-success" role="status">
              <CheckCircle2 size={20}/>
              <div>
                <strong>Pickup berhasil diverifikasi</strong>
                <span>{success.customer_name} · {success.bag_title} × {success.quantity}</span>
                <small>#{success.order_reference} · {rupiah(success.merchant_net_amount)}</small>
              </div>
            </div>
          )}
          <button className="button button-primary redeem-submit" disabled={busy || !complete}>
            {busy ? "Memeriksa kode…" : "Verifikasi dan redeem"}
          </button>
        </form>
        <div className="redeem-footnote">
          Kode hanya bisa dipakai sekali. Pastikan pesanan siap dan pelanggan berada dalam jendela pickup.
        </div>
      </Panel>

      <aside className="redeem-side">
        <Panel title="Pesanan siap pickup">
          {loading && !orders.length ? (
            <div className="no-transactions">Memuat pesanan siap…</div>
          ) : orders.length ? (
            <div className="ready-list">
              {orders.slice(0, 8).map((order) => (
                <div className="ready-item" key={order.id}>
                  <span className="ready-dot"/>
                  <div>
                    <strong>{order.bag_title}</strong>
                    <small>{order.consumer_anonymized ? "Pelanggan" : order.consumer_name} · {order.quantity} bag</small>
                  </div>
                  <StatusPill status="ready"/>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Tidak ada pesanan siap" detail="Pesanan siap pickup akan muncul di sini."/>
          )}
        </Panel>
      </aside>
    </div>
  </>;
}
