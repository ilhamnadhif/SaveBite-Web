"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { formatRupiah, type IncomingOrder, type IncomingOrderStatus, type MerchantBag } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FoodImage } from "../../ui/bagCards";
import { PrimaryButton, TextButton } from "../../ui/buttons";
import { StatusBadge } from "../../ui/chips";
import {
  AppCard,
  ColoredHeader,
  EmptyState,
  Gap,
  LinearProgress,
  ProgressBar,
  RefreshScroll,
  Screen,
  SectionHeading,
} from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { C, clamp, display, ellipsis, ui, withAlpha } from "../../ui/theme";
import { useShellScope } from "../ShellFrame";

/** Merchant dashboard with live stats and orders from the backend (tab 0). */
export function DashboardScreen() {
  const state = useAppState();
  const shell = useShellScope();
  const isOpen = storeIsOpen(state.openTime, state.closeTime);
  const activeBags = state.activeBags;
  const pendingOrders = state.pendingOrders;
  const loadError = state.merchantError ?? state.storeError;

  return (
    <Screen background={C.cream}>
      <ColoredHeader background={C.brown} bottomPadding={24}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={ui(13, { color: C.merchantMuted })}>Halo,</div>
            <h1 style={{ ...display(20, { weight: 700, color: C.cream }), ...ellipsis }}>
              {state.storeName === "" ? "Toko Anda" : state.storeName}
            </h1>
          </div>
          <Gap w={10} />
          <StatusBadge
            text={isOpen ? "● Buka" : "● Tutup"}
            background={isOpen ? C.greenBright : C.scanMuted}
            foreground={C.white}
            weight={800}
            padding="6px 11px"
          />
        </div>
        <Gap h={5} />
        <div style={ui(11.5, { color: C.merchantMuted })}>{`Jam toko ${state.openTime}–${state.closeTime}`}</div>
        <Gap h={18} />
        <div style={{ display: "flex", alignItems: "center" }}>
          <HeaderStatTile value={`${state.bagsSoldToday}`} label="Bag hari ini" />
          <Gap w={10} />
          <HeaderStatTile value={formatRupiah(state.incomeToday)} label="Pendapatan" />
          <Gap w={10} />
          <HeaderStatTile value={`${state.activeBagCount}`} label="Bag aktif" />
        </div>
      </ColoredHeader>
      <RefreshScroll
        onRefresh={() => appState.loadMerchantData()}
        color={C.terracotta}
        style={{ padding: "18px 20px 22px", background: C.cream }}
      >
        {loadError !== null ? (
          <>
            <ErrorCard message={loadError} />
            <Gap h={14} />
          </>
        ) : null}
        {state.isLoadingMerchant && activeBags.length === 0 && pendingOrders.length === 0 ? (
          <>
            <LinearProgress color={C.terracotta} background={C.terracottaSoftBg} />
            <Gap h={14} />
          </>
        ) : null}
        <PrimaryButton
          merchant
          label="Buat Surprise Bag"
          height={56}
          icon={<Icon name="add" color={C.white} size={20} />}
          onTap={() => AppNav.toCreateBag()}
        />
        <Gap h={20} />
        <SectionHeading
          title={`Bag aktif (${state.activeBagCount})`}
          actionLabel="Kelola"
          actionColor={C.terracotta}
          onAction={() => shell?.selectTab(1)}
        />
        <Gap h={11} />
        <ActiveBags bags={activeBags} />
        <Gap h={20} />
        <SectionHeading
          title="Pesanan aktif"
          actionLabel={pendingOrders.length === 0 ? undefined : "Lihat semua"}
          actionColor={C.terracotta}
          onAction={() => shell?.selectTab(2)}
        />
        <Gap h={11} />
        <LatestOrders orders={pendingOrders} />
        <Gap h={20} />
        <ImpactCard foodSavedKg={state.foodSavedKg} />
      </RefreshScroll>
    </Screen>
  );
}

function HeaderStatTile({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 77, padding: 12, background: C.brownCard, borderRadius: 16 }}>
      <ScaleDownText text={value} style={display(20, { weight: 800, color: C.white })} />
      <Gap h={3} />
      <div style={{ ...ui(10.5, { color: C.merchantMuted }), ...clamp(2) }}>{label}</div>
    </div>
  );
}

/**
 * `FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft)` around a
 * single line of text: shrinks the text (never enlarges it) so a long amount
 * still fits its tile.
 */
function ScaleDownText({ text, style }: { text: string; style: CSSProperties }) {
  const box = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLSpanElement | null>(null);
  const [fit, setFit] = useState<{ scale: number; height: number }>({ scale: 1, height: 0 });

  useLayoutEffect(() => {
    const outer = box.current;
    const inner = content.current;
    if (!outer || !inner) return;
    const measure = () => {
      const natural = inner.offsetWidth;
      const available = outer.clientWidth;
      const scale = natural > available && natural > 0 ? available / natural : 1;
      const height = inner.offsetHeight * scale;
      setFit((current) => (current.scale === scale && current.height === height ? current : { scale, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // Re-fit when the tile is resized or the web font finishes loading.
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [text]);

  const scaled = fit.scale < 1;
  return (
    <div ref={box} style={{ display: "flex", alignItems: "flex-start", height: scaled ? fit.height : undefined }}>
      <span
        ref={content}
        style={{
          ...style,
          flex: "none",
          whiteSpace: "nowrap",
          transform: scaled ? `scale(${fit.scale})` : undefined,
          transformOrigin: "left top",
        }}
      >
        {text}
      </span>
    </div>
  );
}

function ActiveBags({ bags }: { bags: readonly MerchantBag[] }) {
  if (bags.length === 0) {
    return (
      <EmptyState
        icon="shopping_bag_outlined"
        title="Belum ada bag aktif"
        message="Buat Surprise Bag untuk mulai berjualan."
        action={
          <div style={{ width: 210 }}>
            <PrimaryButton merchant label="Buat bag pertama" height={46} fontSize={14} onTap={() => AppNav.toCreateBag()} />
          </div>
        }
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {bags.slice(0, 3).map((bag, index) => (
        <ActiveBagCard key={bag.id || `bag-${index}`} bag={bag} />
      ))}
    </div>
  );
}

function ActiveBagCard({ bag }: { bag: MerchantBag }) {
  const stock = bag.quantityLeft < 0 ? 0 : bag.quantityLeft;
  return (
    <AppCard radius={18} onTap={() => AppNav.toEditBag(bag)}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 11, overflow: "hidden", flex: "none" }}>
          <FoodImage path={bag.image} width={56} height={56} />
        </div>
        <Gap w={12} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ ...ui(14, { weight: 700, color: C.ink }), ...ellipsis, flex: 1 }}>{bag.title}</div>
            <Gap w={8} />
            <StatusBadge.available text={`${stock} tersisa`} />
          </div>
          <Gap h={5} />
          <div style={{ ...ui(12, { color: C.body }), ...ellipsis }}>{`${formatRupiah(bag.salePrice)} · ${bag.pickupWindow}`}</div>
          <Gap h={8} />
          <ProgressBar fraction={bag.total === 0 ? 0 : Math.min(1, Math.max(0, bag.sold / bag.total))} />
        </div>
      </div>
    </AppCard>
  );
}

function LatestOrders({ orders }: { orders: readonly IncomingOrder[] }) {
  if (orders.length === 0) {
    return (
      <AppCard radius={16}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Icon name="inbox_outlined" color={C.muted} />
          <Gap w={10} />
          <div style={{ ...ui(12.5, { color: C.muted }), flex: 1, minWidth: 0 }}>Belum ada pesanan aktif.</div>
        </div>
      </AppCard>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {orders.slice(0, 3).map((order, index) => (
        <OrderCard key={order.id || `order-${index}`} order={order} />
      ))}
    </div>
  );
}

function OrderCard({ order }: { order: IncomingOrder }) {
  return (
    <AppCard radius={14} onTap={() => AppNav.toOrderDetail(order)}>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <div
          style={{
            width: 40,
            height: 40,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: C.greenSoftBg,
            borderRadius: 11,
            ...ui(13, { weight: 800, color: C.greenAccent }),
          }}
        >
          {order.initial}
        </div>
        <Gap w={11} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...ui(13.5, { weight: 700, color: C.ink }), ...ellipsis }}>{`${order.customer} · ${order.bags} bag`}</div>
          <Gap h={2} />
          <div style={{ ...ui(12, { color: C.body }), ...ellipsis }}>{order.bagTitle === "" ? "Surprise Bag" : order.bagTitle}</div>
          <Gap h={2} />
          <div style={ui(11.5, { color: C.muted })}>{order.time}</div>
        </div>
        <Gap w={8} />
        <OrderStatusBadge status={order.status} />
      </div>
    </AppCard>
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
      return <StatusBadge.expired text="Batal" />;
    case "expired":
      return <StatusBadge.expired text="Kedaluwarsa" />;
  }
}

function ImpactCard({ foodSavedKg }: { foodSavedKg: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: 16,
        background: C.greenSoftBg,
        borderRadius: 18,
        border: `1px solid ${withAlpha(C.greenBright, 45 / 255)}`,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          flex: "none",
          borderRadius: "50%",
          background: C.greenBright,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="eco_outlined" color={C.white} />
      </div>
      <Gap w={12} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={ui(13.5, { weight: 800, color: C.greenAccent })}>{`${foodSavedKg.toFixed(1)} kg makanan terselamatkan`}</div>
        <Gap h={2} />
        <div style={ui(11.5, { color: C.body })}>Dihitung dari pesanan yang sudah selesai.</div>
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: 13, background: C.dangerTintBg, borderRadius: 14 }}>
      <Icon name="error_outline_rounded" color={C.danger} />
      <Gap w={9} />
      <div style={{ ...ui(12.5, { color: C.danger }), flex: 1, minWidth: 0 }}>{message}</div>
      <TextButton label="Coba lagi" onTap={() => void appState.loadMerchantData()} style={{ flex: "none" }} />
    </div>
  );
}

/** Open/closed from the store hours; an overnight range wraps past midnight. */
function storeIsOpen(openTime: string, closeTime: string): boolean {
  const toMinutes = (value: string): number | null => {
    const parts = value.trim().split(/[:.]/);
    if (parts.length !== 2) return null;
    const hour = tryParseInt(parts[0]);
    const minute = tryParseInt(parts[1]);
    if (hour === null || minute === null || hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  };

  const open = toMinutes(openTime);
  const close = toMinutes(closeTime);
  if (open === null || close === null) return false;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  if (open === close) return true;
  if (open < close) return current >= open && current < close;
  return current >= open || current < close;
}

/** Dart `int.tryParse`: optional sign and decimal digits, whitespace trimmed. */
function tryParseInt(value: string): number | null {
  const text = value.trim();
  return /^[+-]?\d+$/.test(text) ? Number.parseInt(text, 10) : null;
}
