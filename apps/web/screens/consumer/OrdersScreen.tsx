"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState, type AppState } from "../../lib/appState";
import { formatRupiah, isAwaitingCustomer, isTerminalFailure, type OrderRecord } from "../../lib/models";
import type { ConsumerOrdersTab } from "../../lib/notificationRoute";
import { useAppState } from "../../lib/useAppState";
import { FoodImage, StoreAvatar } from "../../ui/bagCards";
import { PrimaryButton, TextButton } from "../../ui/buttons";
import { StatusBadge } from "../../ui/chips";
import { CenteredSpinner, EmptyState, Gap, RefreshScroll, Screen, Spacer, TabSwitch, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { C, display, ellipsis, ui, withAlpha } from "../../ui/theme";

const TABS = ["Aktif", "Riwayat"];

/** `ConsumerOrdersTab.index`. */
const tabIndex = (tab: ConsumerOrdersTab) => (tab === "history" ? 1 : 0);

/** The consumer's orders, split into active and history. Tab 2 of the shell. */
export function OrdersScreen({
  initialTab,
  referencedOrderId,
}: {
  initialTab: ConsumerOrdersTab;
  referencedOrderId: string | null;
}) {
  const state = useAppState();
  const [tab, setTab] = useState(() => tabIndex(tabForReferencedOrder(appState, referencedOrderId) ?? initialTab));
  const referenceTabResolved = useRef(referencedOrderId === null || referencedOrderId.trim() === "");
  const [loading, setLoading] = useState(() => appState.activeOrders.length === 0 && appState.orderHistory.length === 0);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (alive.current && appState.activeOrders.length === 0 && appState.orderHistory.length === 0) setLoading(true);
    try {
      await appState.loadOrders();
      if (!alive.current) return;
      const referencedTab = referenceTabResolved.current ? null : tabForReferencedOrder(appState, referencedOrderId);
      setError(appState.ordersError);
      if (referencedTab !== null) {
        setTab(tabIndex(referencedTab));
        referenceTabResolved.current = true;
      }
    } catch {
      if (!alive.current) return;
      setError("Pesanan gagal dimuat. Periksa koneksi lalu coba lagi.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [referencedOrderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const body = () => {
    if (loading && state.activeOrders.length === 0 && state.orderHistory.length === 0) return <CenteredSpinner />;
    const orders = prioritizeReferenced(tab === 0 ? activeOrdersOf(state) : historyOrdersOf(state), referencedOrderId);
    return (
      <RefreshScroll onRefresh={refresh} style={{ padding: "16px 20px 24px" }}>
        {error !== null ? (
          <>
            <ErrorBanner message={error} onRetry={() => void refresh()} />
            <Gap h={14} />
          </>
        ) : null}
        {orders.length === 0 ? (
          <div style={{ paddingTop: 72 }}>
            <EmptyState
              icon={tab === 0 ? "shopping_bag_outlined" : "receipt_long_outlined"}
              title={tab === 0 ? "Belum ada pesanan aktif" : "Belum ada riwayat pesanan"}
              message={
                tab === 0
                  ? "Pesanan yang sedang berjalan akan muncul di sini."
                  : "Pesanan selesai, dibatalkan, atau kedaluwarsa akan muncul di sini."
              }
            />
          </div>
        ) : tab === 0 ? (
          orders.map((order, index) => <ActiveCard key={order.id ? `active-order-${order.id}` : `active-order#${index}`} order={order} />)
        ) : (
          orders.map((order, index) => (
            <HistoryCard key={order.id ? `history-order-${order.id}` : `history-order#${index}`} order={order} />
          ))
        )}
      </RefreshScroll>
    );
  };

  return (
    <Screen background={C.cream}>
      <div
        style={{
          flex: "none",
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
          paddingTop: safeTop(12),
          paddingRight: 20,
          paddingBottom: 12,
          paddingLeft: 20,
        }}
      >
        <h1 style={display(24, { weight: 800, color: C.ink })}>Pesanan</h1>
        <div style={{ marginTop: 14 }}>
          <TabSwitch
            tabs={TABS}
            index={tab}
            onTap={(index) => {
              setTab(index);
              referenceTabResolved.current = true;
            }}
          />
        </div>
      </div>
      {body()}
    </Screen>
  );
}

function hasExpired(order: OrderRecord): boolean {
  if (order.paymentState === "expired") return true;
  const expiresAt = isAwaitingCustomer(order.paymentState) ? order.paymentExpiresAt : order.expiresAt;
  return expiresAt !== null && !(expiresAt.getTime() > Date.now());
}

function activeOrdersOf(state: AppState): OrderRecord[] {
  return state.activeOrders.filter(
    (order) =>
      (order.status === "pending" || order.status === "ready") &&
      !isTerminalFailure(order.paymentState) &&
      !hasExpired(order),
  );
}

function historyOrdersOf(state: AppState): OrderRecord[] {
  const result = [...state.orderHistory];
  const ids = new Set(result.map((order) => order.id).filter((id) => id !== ""));
  for (const order of state.activeOrders.filter((item) => hasExpired(item) || isTerminalFailure(item.paymentState))) {
    if (order.id === "") {
      result.push(order);
    } else if (!ids.has(order.id)) {
      ids.add(order.id);
      result.push(order);
    }
  }
  return result;
}

function referencedId(referencedOrderId: string | null): string | null {
  const targetId = referencedOrderId?.trim().toLowerCase();
  return targetId ? targetId : null;
}

function tabForReferencedOrder(state: AppState, referencedOrderId: string | null): ConsumerOrdersTab | null {
  const targetId = referencedId(referencedOrderId);
  if (targetId === null) return null;
  const matches = (order: OrderRecord) => order.id.toLowerCase() === targetId;
  if (historyOrdersOf(state).some(matches)) return "history";
  if (activeOrdersOf(state).some(matches)) return "active";
  return null;
}

/** Moves the order a notification points at to the top of its list. */
function prioritizeReferenced(orders: OrderRecord[], referencedOrderId: string | null): OrderRecord[] {
  const targetId = referencedId(referencedOrderId);
  if (targetId === null) return orders;
  const index = orders.findIndex((order) => order.id.toLowerCase() === targetId);
  if (index <= 0) return orders;
  return [orders[index], ...orders.slice(0, index), ...orders.slice(index + 1)];
}

function ActiveCard({ order }: { order: OrderRecord }) {
  const ready = order.status === "ready";
  const awaitingPayment = isAwaitingCustomer(order.paymentState);
  return (
    <div
      style={{
        marginBottom: 14,
        padding: 14,
        background: C.white,
        borderRadius: 18,
        border: `1.5px solid ${C.greenSoftBorder}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <StoreAvatar initial={order.bag.merchant.initial} color={order.bag.merchant.avatarColor} size={40} radius={11} />
        <div style={{ flex: 1, minWidth: 0, marginLeft: 10, marginRight: 8 }}>
          <div style={{ ...ui(14, { weight: 700, color: C.ink }), ...ellipsis }}>{order.bag.merchant.name}</div>
          <div style={{ ...ui(12, { color: C.body }), ...ellipsis, marginTop: 1 }}>{`${order.quantity}× ${order.bag.title}`}</div>
        </div>
        {ready ? (
          <StatusBadge.available text="Siap diambil" />
        ) : awaitingPayment ? (
          <StatusBadge.waiting text="Menunggu bayar" />
        ) : (
          <StatusBadge.waiting text="Diproses" />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 11 }}>
        <Icon name="confirmation_number_outlined" size={15} color={C.muted} />
        <span style={{ ...ui(11.5, { color: C.muted }), marginLeft: 6, whiteSpace: "nowrap" }}>{`Pesanan ${order.code}`}</span>
        <Spacer />
        <span style={{ ...ui(12, { weight: 700, color: C.ink }), whiteSpace: "nowrap" }}>{formatRupiah(order.amount)}</span>
      </div>
      <div style={{ marginTop: 12 }}>
        {ready ? (
          <PrimaryButton label="Tampilkan QR pickup" height={44} fontSize={14} onTap={() => AppNav.toVoucher(order)} />
        ) : awaitingPayment ? (
          <PrimaryButton label="Lanjutkan pembayaran" height={44} fontSize={14} onTap={() => AppNav.toResumePayment(order)} />
        ) : (
          <div
            style={{
              padding: 11,
              background: C.neutralChip,
              borderRadius: 12,
              textAlign: "center",
              ...ui(12, { color: C.body }),
            }}
          >
            Pembayaran sudah diterima. QR tersedia setelah pesanan siap.
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryCard({ order }: { order: OrderRecord }) {
  const expired = order.status === "expired" || hasExpired(order);
  const cancelled = order.status === "cancelled";
  return (
    <div
      style={{
        marginBottom: 12,
        padding: 14,
        background: C.white,
        borderRadius: 18,
        border: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        opacity: expired || cancelled ? 0.76 : 1,
      }}
    >
      <div style={{ width: 46, height: 46, borderRadius: 12, overflow: "hidden", flex: "none" }}>
        <FoodImage path={order.bag.image} saturation={expired || cancelled ? 0.5 : 1} />
      </div>
      <div style={{ flex: 1, minWidth: 0, marginLeft: 12, marginRight: 10 }}>
        <div style={{ ...ui(14, { weight: 700, color: C.ink }), ...ellipsis }}>{order.bag.merchant.name}</div>
        <div style={{ ...ui(12, { color: C.body }), marginTop: 2 }}>{`${order.dateLabel} · ${formatRupiah(order.amount)}`}</div>
      </div>
      <HistoryTrailing order={order} expired={expired} />
    </div>
  );
}

function HistoryTrailing({ order, expired }: { order: OrderRecord; expired: boolean }) {
  if (order.paymentState === "refunded") return <StatusBadge.expired text="Refund diproses" />;
  if (order.paymentState === "disputed") return <StatusBadge.expired text="Ditinjau" />;
  if (order.paymentState === "failed") return <StatusBadge.expired text="Gagal bayar" />;
  if (order.paymentState === "cancelled") return <StatusBadge.expired text="Dibatalkan" />;
  if (order.paymentState === "expired") return <StatusBadge.expired text="Kedaluwarsa" />;
  if (order.status === "cancelled") return <StatusBadge.expired text="Dibatalkan" />;
  if (expired) return <StatusBadge.expired text="Kedaluwarsa" />;
  if (order.status === "pending" || order.status === "ready") return <StatusBadge.waiting text="Diproses" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flex: "none" }}>
      <StatusBadge.done text="Selesai" />
      <Gap h={6} />
      {order.canRate ? (
        <button
          type="button"
          className="sb-ink"
          onClick={() => void AppNav.toRating(order)}
          style={{ borderRadius: 8, padding: "3px 2px", ...ui(12, { weight: 700, color: C.amber }) }}
        >
          ★ Beri rating
        </button>
      ) : order.reviewed ? (
        <span style={ui(12, { weight: 600, color: C.muted })}>Sudah diulas</span>
      ) : null}
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        padding: 13,
        background: C.dangerBg,
        borderRadius: 14,
        border: `1px solid ${withAlpha(C.danger, 0.25)}`,
      }}
    >
      <Icon name="error_outline" size={20} color={C.danger} />
      <span style={{ ...ui(12.5, { color: C.body, height: 1.4 }), flex: 1, minWidth: 0, marginLeft: 10 }}>{message}</span>
      <TextButton label={<span style={ui(12.5, { weight: 700, color: C.danger })}>Coba lagi</span>} onTap={onRetry} />
    </div>
  );
}

