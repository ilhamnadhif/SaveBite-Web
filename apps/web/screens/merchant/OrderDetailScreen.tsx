"use client";

import { useEffect, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState, type AppState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import { FALLBACK_IMAGE, formatRupiah, type IncomingOrder, type IncomingOrderStatus } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FoodImage } from "../../ui/bagCards";
import { OutlinedButton, PrimaryButton } from "../../ui/buttons";
import { StatusBadge } from "../../ui/chips";
import {
  AppCard,
  Divider,
  Gap,
  RefreshScroll,
  Screen,
  SectionHeading,
  SimpleHeader,
  Spinner,
  safeBottom,
} from "../../ui/common";
import { Icon, type IconName } from "../../ui/Icon";
import { confirmDialog, snack } from "../../ui/overlays";
import { C, clamp, display, ui } from "../../ui/theme";

/**
 * Operational order detail. The pickup token is deliberately never rendered
 * on the merchant screen; the cashier must scan the customer's QR.
 */
export function OrderDetailScreen({ order: routeOrder }: { order: IncomingOrder }) {
  const state = useAppState();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setBusyState = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };

  const markReady = async (order: IncomingOrder) => {
    if (busyRef.current || !order.id) return;
    setBusyState(true);
    try {
      await appState.markOrderReady(order.id);
      if (alive.current) snack("Pesanan ditandai siap diambil.", "check_circle_outline_rounded");
    } catch (error) {
      if (!alive.current) return;
      snack(
        error instanceof BackendException ? error.message : "Status pesanan belum dapat diperbarui.",
        "error_outline_rounded",
      );
    } finally {
      if (alive.current) setBusyState(false);
    }
  };

  const cancelOrder = async (order: IncomingOrder) => {
    if (busyRef.current || !order.id) return;
    const confirmed = await confirmDialog({
      title: "Batalkan pesanan?",
      message:
        "Midtrans akan membatalkan atau mengembalikan pembayaran untuk " +
        `${reference(order)}. Stok ${order.bags} bag baru dikembalikan ` +
        "setelah provider mengonfirmasi. Tindakan ini tidak dapat dibatalkan.",
      confirmLabel: "Batalkan pesanan",
      destructive: true,
    });
    if (!confirmed || !alive.current) return;
    setBusyState(true);
    try {
      await appState.cancelMerchantOrder(order.id);
      if (alive.current) {
        snack(
          "Pembatalan/refund telah dikonfirmasi Midtrans untuk diproses. Stok telah " +
            "dikembalikan; waktu dana masuk mengikuti metode pembayaran.",
          "inventory_2_outlined",
        );
      }
    } catch (error) {
      if (!alive.current) return;
      snack(error instanceof BackendException ? error.message : "Pesanan belum dapat dibatalkan.", "error_outline_rounded");
    } finally {
      if (alive.current) setBusyState(false);
    }
  };

  const order = currentOrder(state, routeOrder);

  return (
    <Screen>
      <SimpleHeader title="Detail Pesanan" />
      <RefreshScroll color={C.terracotta} onRefresh={() => appState.loadMerchantData()} style={{ padding: "18px 20px 22px" }}>
        <CustomerCard order={order} />
        <Gap h={18} />
        <SectionHeading title="Item pesanan" />
        <Gap h={11} />
        <ItemCard order={order} />
        <Gap h={18} />
        <SectionHeading title="Jadwal pickup" />
        <Gap h={11} />
        <PickupCard order={order} />
        <Gap h={18} />
        <SectionHeading title="Rincian pembayaran" />
        <Gap h={11} />
        <PaymentCard order={order} />
        <Gap h={14} />
        <div style={{ display: "flex", alignItems: "flex-start", padding: 13, background: C.neutralChip, borderRadius: 13 }}>
          <Icon name="security_rounded" size={18} color={C.body} />
          <div style={{ width: 9, flex: "none" }} />
          <p style={{ ...ui(12, { color: C.body, height: 1.4 }), flex: 1, minWidth: 0 }}>
            Kode dan token pickup hanya ada di perangkat pembeli. Gunakan scanner untuk mencegah redeem tanpa izin.
          </p>
        </div>
      </RefreshScroll>
      <div
        style={{
          flex: "none",
          width: "100%",
          background: C.white,
          borderTop: `1px solid ${C.border}`,
          padding: "14px 20px 0",
          paddingBottom: safeBottom(18),
        }}
      >
        <BottomBarContent
          order={order}
          busy={busy}
          onMarkReady={() => void markReady(order)}
          onCancel={() => void cancelOrder(order)}
        />
      </div>
    </Screen>
  );
}

/** `_currentOrder`: the latest copy of the order from the merchant lists. */
function currentOrder(state: AppState, order: IncomingOrder): IncomingOrder {
  for (const candidate of [...state.pendingOrders, ...state.completedOrders]) {
    if (order.id && candidate.id === order.id) return candidate;
    if (
      !order.id &&
      candidate.customer === order.customer &&
      candidate.time === order.time &&
      candidate.bags === order.bags
    ) {
      return candidate;
    }
  }
  return order;
}

function CustomerCard({ order }: { order: IncomingOrder }) {
  return (
    <AppCard>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <div
          style={{
            width: 44,
            height: 44,
            flex: "none",
            background: C.terracottaSoftBg,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...display(17, { weight: 800, color: C.brown }),
          }}
        >
          {order.initial}
        </div>
        <div style={{ width: 12, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...ui(14.5, { weight: 700, color: C.ink }), overflowWrap: "anywhere" }}>{order.customer}</div>
          <div style={{ ...ui(12, { color: C.muted }), marginTop: 3 }}>{`${reference(order)} · ${order.time}`}</div>
          {order.createdAt ? (
            <div style={{ ...ui(11.5, { color: C.muted }), marginTop: 2 }}>{dateTimeLabel(order.createdAt)}</div>
          ) : null}
        </div>
        <div style={{ width: 8, flex: "none" }} />
        <OrderStatusBadge status={order.status} />
      </div>
    </AppCard>
  );
}

function ItemCard({ order }: { order: IncomingOrder }) {
  const subtotal = subtotalOf(order);
  return (
    <AppCard>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ width: 58, height: 58, flex: "none", borderRadius: 12, overflow: "hidden" }}>
          <FoodImage path={order.bagImage || FALLBACK_IMAGE} width={58} height={58} />
        </div>
        <div style={{ width: 12, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...ui(14, { weight: 700, color: C.ink }), ...clamp(2) }}>{order.bagTitle || "Surprise Bag"}</div>
          <div style={{ ...ui(12.5, { color: C.muted }), marginTop: 3 }}>
            {`${order.bags} bag${order.unitPrice > 0 ? ` × ${formatRupiah(order.unitPrice)}` : ""}`}
          </div>
        </div>
        <div style={{ width: 10, flex: "none" }} />
        <span style={{ ...ui(14, { weight: 700, color: C.ink }), flex: "none", whiteSpace: "nowrap" }}>
          {subtotal > 0 ? formatRupiah(subtotal) : "—"}
        </span>
      </div>
    </AppCard>
  );
}

function PickupCard({ order }: { order: IncomingOrder }) {
  return (
    <AppCard>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Icon name="schedule_outlined" size={19} color={C.terracotta} />
        <div style={{ width: 8, flex: "none" }} />
        <div style={{ ...ui(13.5, { weight: 700, color: C.ink }), flex: 1, minWidth: 0 }}>
          {order.pickupWindow || "Jadwal pickup belum tersedia"}
        </div>
      </div>
      {order.expiresAt ? (
        <div style={{ ...ui(12, { color: C.body }), marginTop: 8 }}>{`Berlaku sampai ${dateTimeLabel(order.expiresAt)}`}</div>
      ) : null}
      {order.redeemedAt ? (
        <div style={{ ...ui(12, { weight: 700, color: C.greenAccent }), marginTop: 8 }}>
          {`Diambil ${dateTimeLabel(order.redeemedAt)}`}
        </div>
      ) : null}
    </AppCard>
  );
}

function PaymentCard({ order }: { order: IncomingOrder }) {
  const subtotal = subtotalOf(order);
  const net = order.merchantNetAmount;
  const platformFee = subtotal > 0 && net > 0 ? Math.min(Math.max(subtotal - net, 0), subtotal) : 0;
  return (
    <AppCard>
      <Line label="Subtotal item" value={subtotal > 0 ? formatRupiah(subtotal) : "—"} />
      {order.serviceFee > 0 ? (
        <>
          <Gap h={11} />
          <Line label="Biaya layanan pembeli" value={formatRupiah(order.serviceFee)} />
        </>
      ) : null}
      <Gap h={11} />
      <Line label="Biaya platform merchant" value={platformFee > 0 ? `−${formatRupiah(platformFee)}` : "—"} />
      <Gap h={13} />
      <Divider color={C.divider} />
      <Gap h={13} />
      <Line label="Masuk saldo" value={net > 0 ? formatRupiah(net) : "—"} valueColor={C.greenAccent} bold />
      {order.status !== "redeemed" ? (
        <>
          <Gap h={9} />
          <div style={ui(11.5, { color: C.muted })}>Saldo dicatat setelah pickup berhasil di-redeem.</div>
        </>
      ) : null}
    </AppCard>
  );
}

function Line({
  label,
  value,
  valueColor = C.ink,
  bold = false,
}: {
  label: string;
  value: string;
  valueColor?: string;
  bold?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      <span style={{ ...ui(13.5, { weight: bold ? 700 : 500, color: bold ? C.ink : C.body }), flex: 1, minWidth: 0 }}>
        {label}
      </span>
      <div style={{ width: 12, flex: "none" }} />
      <span
        style={{
          ...ui(14, { weight: bold ? 800 : 600, color: valueColor }),
          textAlign: "right",
          flex: "none",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function BottomBarContent({
  order,
  busy,
  onMarkReady,
  onCancel,
}: {
  order: IncomingOrder;
  busy: boolean;
  onMarkReady: () => void;
  onCancel: () => void;
}) {
  const cancelButton = <CancelButton onTap={busy || !order.id ? null : onCancel} />;
  switch (order.status) {
    case "paid":
    case "preparing":
      return (
        <>
          <PrimaryButton
            merchant
            label={busy ? "Menyimpan…" : "Tandai siap diambil"}
            icon={
              busy ? (
                <Spinner size={18} strokeWidth={2} color={C.white} />
              ) : (
                <Icon name="inventory_2_outlined" size={20} color={C.white} />
              )
            }
            onTap={busy || !order.id ? null : onMarkReady}
          />
          <Gap h={9} />
          {cancelButton}
        </>
      );
    case "ready":
      return (
        <>
          <PrimaryButton
            merchant
            label="Scan QR untuk redeem"
            icon={<Icon name="qr_code_scanner_rounded" size={20} color={C.white} />}
            onTap={busy ? null : () => void AppNav.toScanQr()}
          />
          <Gap h={9} />
          {cancelButton}
        </>
      );
    case "redeemed":
      return <StatusMessage icon="check_circle_rounded" text="Pesanan sudah diambil" color={C.greenAccent} />;
    case "pending":
      return <StatusMessage icon="schedule_rounded" text="Menunggu pembayaran pembeli" color={C.muted} />;
    case "cancelled":
      return <StatusMessage icon="cancel_outlined" text="Pesanan dibatalkan" color={C.danger} />;
    case "expired":
      return <StatusMessage icon="timer_off_outlined" text="Masa pickup sudah berakhir" color={C.danger} />;
  }
}

function StatusMessage({ icon, text, color }: { icon: IconName; text: string; color: string }) {
  return (
    <div style={{ padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={19} color={color} />
      <div style={{ width: 8, flex: "none" }} />
      <span style={ui(14, { weight: 700, color })}>{text}</span>
    </div>
  );
}

/**
 * `SizedBox(width: infinity, height: 46, child: OutlinedButton.icon(...))` in
 * danger colours. The fixed height also drops the 48px tap-target padding.
 */
function CancelButton({ onTap }: { onTap: (() => void) | null }) {
  return (
    <OutlinedButton
      label="Batalkan pesanan"
      icon="cancel_outlined"
      iconSize={19}
      color={C.danger}
      onTap={onTap}
      style={{ width: "100%", height: 46, margin: 0, border: `1px solid ${C.danger}`, borderRadius: 999 }}
    />
  );
}

function OrderStatusBadge({ status }: { status: IncomingOrderStatus }) {
  switch (status) {
    case "pending":
      return <StatusBadge.waiting text="Menunggu bayar" />;
    case "paid":
      return <StatusBadge text="Baru" background={C.terracottaSoftBg} foreground={C.brown} />;
    case "preparing":
      return <StatusBadge text="Disiapkan" background={C.terracottaSoftBg} foreground={C.brown} />;
    case "ready":
      return <StatusBadge.available text="Siap" />;
    case "redeemed":
      return <StatusBadge.done text="Selesai" />;
    case "cancelled":
      return <StatusBadge.expired text="Dibatalkan" />;
    case "expired":
      return <StatusBadge.expired text="Kedaluwarsa" />;
  }
}

function subtotalOf(order: IncomingOrder): number {
  if (order.subtotalAmount > 0) return order.subtotalAmount;
  return order.unitPrice > 0 ? order.unitPrice * order.bags : 0;
}

function reference(order: IncomingOrder): string {
  if (!order.id) return "Pesanan baru";
  const clean = order.id.split("-").join("");
  const suffix = clean.length <= 6 ? clean : clean.slice(clean.length - 6);
  return `Order #${suffix.toUpperCase()}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function dateTimeLabel(value: Date): string {
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}, ${hour}.${minute}`;
}
