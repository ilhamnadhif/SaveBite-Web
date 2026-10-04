"use client";

import { useEffect, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { formatRupiah, type Bag } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FoodImage } from "../../ui/bagCards";
import { PrimaryButton } from "../../ui/buttons";
import { Gap, QtyStepper, Screen, Scroll, SimpleHeader, safeBottom } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, display, ui } from "../../ui/theme";

const BACKEND_QUANTITY_LIMIT = 100;

/**
 * Material 3 `ListTile` text colours: `onSurface` / `onSurfaceVariant` of the
 * app's `ColorScheme.fromSeed(seedColor: AppColors.green)`.
 */
const M3_ON_SURFACE = "#171D1A";
const M3_ON_SURFACE_VARIANT = "#404944";

/** B5 Checkout & Bayar. Full screen with its own scaffold, stateful. */
export function CheckoutScreen({ bag }: { bag: Bag }) {
  const state = useAppState();
  const [qty, setQty] = useState(1);
  const [selectedMethod] = useState("QRIS");
  const [navigating, setNavigating] = useState(false);
  const navigatingRef = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const serviceFee = state.businessConfig.serviceFee;
  const maximumQuantity = bag.quantityLeft < BACKEND_QUANTITY_LIMIT ? bag.quantityLeft : BACKEND_QUANTITY_LIMIT;
  const subtotal = bag.salePrice * qty;
  const total = subtotal + serviceFee;

  const continueToPayment = async () => {
    if (navigatingRef.current) return;
    if (bag.soldOut || maximumQuantity < 1 || qty > maximumQuantity) {
      snack("Stok bag sudah berubah. Kembali dan muat ulang ketersediaan.", "error_outline");
      return;
    }
    if (appState.usesRemoteBackend && !appState.businessConfig.paymentsEnabled) {
      snack("Pembayaran sedang dinonaktifkan oleh server. Coba beberapa saat lagi.", "error_outline");
      return;
    }
    navigatingRef.current = true;
    setNavigating(true);
    AppNav.toProcessing({ bag, qty, method: selectedMethod });
    // The push is synchronous. Reset the guard after the transition so the
    // button works again without ever opening two screens at once.
    await new Promise<void>((resolve) => setTimeout(resolve, 450));
    if (mounted.current) {
      navigatingRef.current = false;
      setNavigating(false);
    }
  };

  return (
    <Screen background={C.cream}>
      <SimpleHeader title="Checkout" />
      <Scroll style={{ padding: "18px 20px" }}>
        <ItemCard bag={bag} />
        <Gap h={16} />
        <div
          style={{
            background: C.white,
            borderRadius: 16,
            border: `1px solid ${C.border}`,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={ui(14, { weight: 700 })}>Jumlah bag</span>
          <QtyStepper
            value={qty}
            onMinus={qty > 1 ? () => setQty((value) => value - 1) : null}
            onPlus={qty < maximumQuantity ? () => setQty((value) => value + 1) : null}
          />
        </div>
        <Gap h={20} />
        <h2 style={ui(14, { weight: 700 })}>Metode pembayaran</h2>
        <Gap h={11} />
        <MethodsCard />
        <Gap h={20} />
        <div style={{ background: C.white, borderRadius: 18, border: `1px solid ${C.border}`, padding: 16 }}>
          <SummaryRow label="Subtotal" value={formatRupiah(subtotal)} />
          <Gap h={9} />
          <SummaryRow label="Biaya layanan" value={formatRupiah(serviceFee)} />
          <div style={{ height: 1, background: C.border, margin: "6px 0 11px" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={ui(15, { weight: 700 })}>Total</span>
            <span style={display(20, { color: C.green })}>{formatRupiah(total)}</span>
          </div>
        </div>
      </Scroll>
      <div
        style={{
          flex: "none",
          background: C.white,
          borderTop: `1px solid ${C.border}`,
          paddingTop: 14,
          paddingRight: 20,
          paddingBottom: safeBottom(14),
          paddingLeft: 20,
        }}
      >
        <PrimaryButton
          label={navigating ? "Menyiapkan pembayaran…" : `Lanjutkan · ${formatRupiah(total)}`}
          onTap={navigating || bag.soldOut || bag.quantityLeft < 1 ? null : () => void continueToPayment()}
        />
      </div>
    </Screen>
  );
}

function ItemCard({ bag }: { bag: Bag }) {
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 18,
        border: `1px solid ${C.border}`,
        padding: 14,
        display: "flex",
        alignItems: "flex-start",
      }}
    >
      <FoodImage path={bag.image} width={58} height={58} />
      <Gap w={12} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={ui(14, { weight: 700 })}>{bag.title}</div>
        <Gap h={2} />
        <div style={ui(12.5, { color: C.body })}>{bag.merchant.name}</div>
        <Gap h={5} />
        <div style={ui(12.5, { weight: 700, color: C.greenBright })}>{`Ambil ${bag.pickupWindow} hari ini`}</div>
      </div>
    </div>
  );
}

/** The single QRIS `ListTile` (Material 3 metrics: 16/24 padding, 16 gaps, min height 72). */
function MethodsCard() {
  return (
    <div style={{ background: C.white, borderRadius: 18, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, minHeight: 72, padding: "8px 24px 8px 16px" }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: C.green,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <Icon name="qr_code_2_rounded" size={21} color={C.amber} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={ui(16, { weight: 400, color: M3_ON_SURFACE, height: 1.5, letterSpacing: 0.5 })}>QRIS</div>
          <div style={ui(14, { weight: 400, color: M3_ON_SURFACE_VARIANT, height: 1.43, letterSpacing: 0.25 })}>
            Pindai dengan aplikasi pembayaran yang mendukung QRIS
          </div>
        </div>
        <Icon name="verified_user_outlined" size={24} color={C.greenBright} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={ui(13.5, { color: C.body })}>{label}</span>
      <span style={ui(13.5, { color: C.body })}>{value}</span>
    </div>
  );
}
