"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import type { IncomingOrder, IncomingOrderStatus } from "../../lib/models";
import type { MerchantOrdersTab } from "../../lib/notificationRoute";
import { useAppState } from "../../lib/useAppState";
import { IconButton, OutlinedButton, PrimaryButton, TextButton } from "../../ui/buttons";
import { StatusBadge } from "../../ui/chips";
import { CenteredSpinner, EmptyState, Gap, RefreshScroll, Screen, Spinner, TabSwitch, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { confirmDialog, snack } from "../../ui/overlays";
import { C, display, ellipsis, ui } from "../../ui/theme";

/** `MerchantOrdersTab.values`: the tab index is the enum index. */
const TABS: readonly MerchantOrdersTab[] = ["active", "closed"];

/**
 * Merchant order operations (shell tab 2). The pickup token is never shown;
 * redeeming only happens from the QR scanner.
 */
export function IncomingOrdersScreen({
  initialTab,
  referencedOrderId,
}: {
  initialTab: MerchantOrdersTab;
  referencedOrderId: string | null;
}) {
  const state = useAppState();
  const [initial] = useState(() => {
    const referencedTab = tabForReferencedOrder(referencedOrderId);
    return {
      tab: TABS.indexOf(referencedTab ?? initialTab),
      resolved: !referencedOrderId?.trim() || referencedTab !== null,
    };
  });
  const [tab, setTab] = useState(initial.tab);
  const referenceTabResolved = useRef(initial.resolved);
  const [busyOrderKeys, setBusyOrderKeys] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef(new Set<string>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // `appState.addListener(_resolveReferencedOrder)`: the referenced order may
  // only arrive with a later load; jump to its tab once, unless the merchant
  // already picked a tab.
  useEffect(() => {
    const resolveReferencedOrder = () => {
      if (referenceTabResolved.current) return;
      const referencedTab = tabForReferencedOrder(referencedOrderId);
      if (referencedTab === null) return;
      referenceTabResolved.current = true;
      setTab(TABS.indexOf(referencedTab));
    };
    appState.addListener(resolveReferencedOrder);
    // Catch up with a change that landed between the first render and now.
    resolveReferencedOrder();
    return () => appState.removeListener(resolveReferencedOrder);
  }, [referencedOrderId]);

  const setBusy = (key: string, busy: boolean) => {
    if (busy) busyRef.current.add(key);
    else busyRef.current.delete(key);
    setBusyOrderKeys(new Set(busyRef.current));
  };

  const markReady = async (order: IncomingOrder) => {
    const key = orderKey(order);
    if (busyRef.current.has(key) || !order.id) return;
    setBusy(key, true);
    try {
      await appState.markOrderReady(order.id);
      if (alive.current) snack("Pesanan ditandai siap diambil.", "check_circle_outline_rounded");
    } catch (error) {
      if (!alive.current) return;
      const message = error instanceof BackendException ? error.message : "Status pesanan belum dapat diperbarui.";
      snack(message, "error_outline_rounded");
    } finally {
      if (alive.current) setBusy(key, false);
    }
  };

  const cancelOrder = async (order: IncomingOrder) => {
    const key = orderKey(order);
    if (busyRef.current.has(key) || !order.id) return;
    const confirmed = await confirmDialog({
      title: "Batalkan pesanan?",
      message:
        "Midtrans akan membatalkan atau mengembalikan pembayaran untuk " +
        `${orderReference(order)}. Stok ${order.bags} bag baru dikembalikan ` +
        "setelah provider mengonfirmasi. Tindakan ini tidak dapat dibatalkan.",
      confirmLabel: "Batalkan pesanan",
      destructive: true,
    });
    if (!confirmed || !alive.current) return;
    setBusy(key, true);
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
      if (alive.current) setBusy(key, false);
    }
  };

  const pendingOrderCount = state.pendingOrderCount;
  const orders = prioritizeReferenced(tab === 0 ? state.pendingOrders : state.completedOrders, referencedOrderId);
  const merchantError = state.merchantError;
  const tabName = TABS[tab] ?? "active";

  return (
    <Screen>
      <div
        style={{
          flex: "none",
          paddingTop: safeTop(16),
          paddingRight: 20,
          paddingBottom: 12,
          paddingLeft: 20,
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <h1 style={{ ...display(24, { weight: 800, color: C.ink }), flex: 1, minWidth: 0 }}>Pesanan masuk</h1>
          {state.isLoadingMerchant ? <Spinner size={18} strokeWidth={2} /> : null}
          <div style={{ width: 8, flex: "none" }} />
          <IconButton
            tooltip="Ulasan pelanggan"
            icon="reviews_outlined"
            color={C.brown}
            onTap={() => AppNav.toMerchantReviews()}
          />
        </div>
        <Gap h={14} />
        <TabSwitch
          tabs={["Aktif", "Ditutup"]}
          index={tab}
          onTap={(index) => {
            setTab(index);
            referenceTabResolved.current = true;
          }}
          activeColor={C.brown}
          underlineColor={C.terracotta}
          badges={
            pendingOrderCount > 0
              ? {
                  0: (
                    <span
                      style={{
                        padding: "1px 6px",
                        background: C.terracotta,
                        borderRadius: 10,
                        ...ui(10, { weight: 700, color: C.white }),
                      }}
                    >
                      {pendingOrderCount}
                    </span>
                  ),
                }
              : undefined
          }
        />
      </div>
      {state.isLoadingMerchant && orders.length === 0 ? (
        <CenteredSpinner />
      ) : (
        <RefreshScroll
          color={C.terracotta}
          onRefresh={() => appState.loadMerchantData()}
          style={{ padding: "16px 20px 20px" }}
        >
          {merchantError !== null ? (
            <>
              <ErrorCard message={merchantError} />
              <Gap h={14} />
            </>
          ) : null}
          {orders.length === 0 ? (
            <div style={{ paddingTop: 64 }}>
              <EmptyState
                icon={tab === 0 ? "inbox_outlined" : "check_circle_outline_rounded"}
                title={tab === 0 ? "Tidak ada pesanan aktif" : "Belum ada pesanan ditutup"}
                message={
                  tab === 0
                    ? "Pesanan baru akan muncul otomatis di sini."
                    : "Pesanan selesai, dibatalkan, atau kedaluwarsa akan muncul di sini."
                }
              />
            </div>
          ) : (
            orders.map((order, index) => (
              <Fragment key={`merchant-${tabName}-order-${order.id || `${orderKey(order)}#${index}`}`}>
                {index > 0 ? <Gap h={12} /> : null}
                <OrderCard
                  order={order}
                  testId={`merchant-${tabName}-order-${order.id}`}
                  busy={busyOrderKeys.has(orderKey(order))}
                  onMarkReady={() => void markReady(order)}
                  onCancel={() => void cancelOrder(order)}
                />
              </Fragment>
            ))
          )}
        </RefreshScroll>
      )}
    </Screen>
  );
}

function tabForReferencedOrder(referencedOrderId: string | null): MerchantOrdersTab | null {
  const targetId = referencedOrderId?.trim().toLowerCase();
  if (!targetId) return null;
  const matches = (order: IncomingOrder) => order.id.toLowerCase() === targetId;
  if (appState.completedOrders.some(matches)) return "closed";
  if (appState.pendingOrders.some(matches)) return "active";
  return null;
}

/** The order a notification points at is listed first. */
function prioritizeReferenced(orders: IncomingOrder[], referencedOrderId: string | null): IncomingOrder[] {
  const targetId = referencedOrderId?.trim().toLowerCase();
  if (!targetId) return orders;
  const index = orders.findIndex((order) => order.id.toLowerCase() === targetId);
  if (index <= 0) return orders;
  return [orders[index], ...orders.slice(0, index), ...orders.slice(index + 1)];
}

function orderKey(order: IncomingOrder): string {
  return order.id ? order.id : `${order.customer}|${order.time}|${order.bags}`;
}

function orderReference(order: IncomingOrder): string {
  if (!order.id) return "Pesanan baru";
  const clean = order.id.split("-").join("");
  const suffix = clean.length <= 6 ? clean : clean.slice(clean.length - 6);
  return `Order #${suffix.toUpperCase()}`;
}

/**
 * `AppCard(onTap: toOrderDetail)` around the order. The whole card is one
 * button laid under the content so the action buttons stay separate controls;
 * a disabled action lets the tap through to the card, as in Flutter.
 */
function OrderCard({
  order,
  testId,
  busy,
  onMarkReady,
  onCancel,
}: {
  order: IncomingOrder;
  testId: string;
  busy: boolean;
  onMarkReady: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const actionable = order.status === "paid" || order.status === "preparing";
  const ready = order.status === "ready";
  const terminal = order.status === "redeemed" || order.status === "cancelled" || order.status === "expired";
  const reference = orderReference(order);
  const markReadyEnabled = !busy && Boolean(order.id);

  return (
    <div
      data-testid={testId}
      style={{
        position: "relative",
        background: C.white,
        borderRadius: 18,
        border: `${ready ? 1.4 : 1}px solid ${ready ? C.greenBright : C.border}`,
      }}
    >
      <button
        type="button"
        className="sb-tap"
        aria-labelledby={`${id}-customer ${id}-reference`}
        onClick={() => AppNav.toOrderDetail(order)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: 17 }}
      />
      <div style={{ position: "relative", padding: 15, pointerEvents: "none" }}>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div
            style={{
              width: 42,
              height: 42,
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: terminal ? C.greenSoftBg : C.terracottaSoftBg,
              borderRadius: 11,
              ...ui(14, { weight: 800, color: terminal ? C.greenAccent : C.brown }),
            }}
          >
            {order.initial}
          </div>
          <div style={{ width: 11, flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id={`${id}-customer`} style={{ ...ui(14.5, { weight: 700, color: C.ink }), ...ellipsis }}>
              {order.customer}
            </div>
            <div id={`${id}-reference`} style={{ ...ui(11.5, { color: C.muted }), marginTop: 2 }}>
              {`${reference} · ${order.time}`}
            </div>
          </div>
          <div style={{ width: 8, flex: "none" }} />
          <OrderStatusBadge status={order.status} />
        </div>
        <Gap h={13} />
        <div style={{ padding: 12, background: C.cream, borderRadius: 12 }}>
          <div style={{ ...ui(13.5, { weight: 700, color: C.ink }), ...ellipsis }}>{order.bagTitle || "Surprise Bag"}</div>
          <div style={{ ...ui(12, { color: C.body }), marginTop: 4 }}>
            {`${order.bags} bag${order.pickupWindow ? ` · ambil ${order.pickupWindow}` : ""}`}
          </div>
        </div>
        {!terminal ? (
          <>
            <Gap h={12} />
            {actionable ? (
              <>
                <PrimaryButton
                  merchant
                  label={busy ? "Menyimpan…" : "Tandai siap diambil"}
                  height={46}
                  fontSize={14}
                  icon={
                    busy ? (
                      <Spinner size={17} strokeWidth={2} color={C.white} />
                    ) : (
                      <Icon name="inventory_2_outlined" size={18} color={C.white} />
                    )
                  }
                  onTap={markReadyEnabled ? onMarkReady : null}
                  style={{ pointerEvents: markReadyEnabled ? "auto" : undefined }}
                />
                <Gap h={8} />
                <CancelButton enabled={markReadyEnabled} onTap={onCancel} />
              </>
            ) : ready ? (
              <>
                <PrimaryButton
                  label="Scan QR untuk redeem"
                  height={46}
                  fontSize={14}
                  background={C.green}
                  foreground={C.white}
                  icon={<Icon name="qr_code_scanner_rounded" size={18} color={C.white} />}
                  onTap={busy ? null : () => void AppNav.toScanQr()}
                  style={{ pointerEvents: busy ? undefined : "auto" }}
                />
                <Gap h={8} />
                <CancelButton enabled={markReadyEnabled} onTap={onCancel} />
              </>
            ) : (
              <p style={ui(12, { color: C.muted })}>Pesanan belum dibayar dan belum perlu disiapkan.</p>
            )}
          </>
        ) : null}
      </div>
    </div>
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

/**
 * `SizedBox(width: infinity, height: 43, child: OutlinedButton.icon(...))` in
 * danger colours. The fixed height also drops the 48px tap-target padding.
 */
function CancelButton({ enabled, onTap }: { enabled: boolean; onTap: () => void }) {
  return (
    <OutlinedButton
      label="Batalkan pesanan"
      icon="cancel_outlined"
      iconSize={18}
      color={C.danger}
      onTap={enabled ? onTap : null}
      style={{
        width: "100%",
        height: 43,
        margin: 0,
        border: `1px solid ${C.danger}`,
        borderRadius: 999,
        pointerEvents: enabled ? "auto" : undefined,
      }}
    />
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{ display: "flex", alignItems: "center", padding: 13, background: C.dangerTintBg, borderRadius: 14 }}
    >
      <Icon name="error_outline_rounded" color={C.danger} />
      <div style={{ width: 9, flex: "none" }} />
      <span style={{ ...ui(12.5, { color: C.danger }), flex: 1, minWidth: 0 }}>{message}</span>
      <TextButton label="Coba lagi" onTap={() => void appState.loadMerchantData()} />
    </div>
  );
}
