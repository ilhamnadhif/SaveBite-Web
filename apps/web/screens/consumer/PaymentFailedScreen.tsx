"use client";

import { useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { formatRupiah, type Bag } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FoodImage } from "../../ui/bagCards";
import { GhostButton, IconButton, PrimaryButton, TextButton } from "../../ui/buttons";
import { Gap, Screen, Scroll, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { C, display, ellipsis, ui } from "../../ui/theme";

/**
 * The order could not be confirmed. Retrying carries the same idempotency key
 * so a first attempt the server did accept is never duplicated.
 */
export function PaymentFailedScreen({
  bag,
  method,
  qty,
  idempotencyKey,
  message,
}: {
  bag: Bag;
  method: string;
  qty: number;
  idempotencyKey: string | null;
  message: string | null;
}) {
  const [navigating, setNavigating] = useState(false);
  const navigatingRef = useRef(false);

  const retry = () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    setNavigating(true);
    AppNav.toProcessing({ bag, qty, method, idempotencyKey, replace: true });
  };

  const backToCheckout = navigating ? null : () => void AppNav.back();

  return (
    <Screen
      background={C.cream}
      style={{ paddingTop: safeTop(16), paddingRight: 24, paddingBottom: 24, paddingLeft: 24 }}
    >
      <div style={{ display: "flex", flex: "none" }}>
        <IconButton tooltip="Kembali ke checkout" icon="close" size={22} color={C.ink} onTap={backToCheckout} />
      </div>
      <Scroll>
        <div
          style={{
            minHeight: "58dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 96,
              height: 96,
              marginBottom: 22,
              borderRadius: "50%",
              background: C.dangerBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <Icon name="error_outline" size={44} color={C.danger} />
          </div>
          <h1 style={{ ...display(23, { weight: 800, color: C.ink }), textAlign: "center" }}>Pesanan belum berhasil</h1>
          <Gap h={8} />
          <p style={{ ...ui(14, { color: C.body, height: 1.55 }), maxWidth: 310, textAlign: "center" }}>
            {message ?? "Pesanan belum dapat dikonfirmasi. Periksa koneksi lalu coba lagi."}
          </p>
          <Gap h={24} />
          <ItemCard bag={bag} qty={qty} method={method} />
        </div>
      </Scroll>
      <PrimaryButton label={navigating ? "Mencoba lagi…" : "Coba lagi"} onTap={navigating ? null : retry} />
      <Gap h={8} />
      <GhostButton label="Kembali ke checkout" onTap={backToCheckout} />
      <TextButton
        label={<span style={ui(12.5, { weight: 700, color: C.muted })}>Kembali ke beranda</span>}
        onTap={navigating ? null : () => AppNav.toConsumerHome()}
        style={{ width: "100%" }}
      />
    </Screen>
  );
}

function ItemCard({ bag, qty, method }: { bag: Bag; qty: number; method: string }) {
  const state = useAppState();
  const subtotal = bag.salePrice * qty;
  const serviceFee = state.businessConfig.serviceFee;
  return (
    <div
      style={{
        width: "100%",
        padding: "13px 16px",
        background: C.white,
        borderRadius: 16,
        border: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
      }}
    >
      <div style={{ width: 46, height: 46, borderRadius: 11, overflow: "hidden", flex: "none" }}>
        <FoodImage path={bag.image} width={46} height={46} />
      </div>
      <Gap w={12} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...ui(13.5, { weight: 700, color: C.ink }), ...ellipsis }}>{bag.title}</div>
        <Gap h={2} />
        <div style={ui(12, { color: C.body })}>{`${qty} bag · ${method}`}</div>
      </div>
      <Gap w={10} />
      <span style={{ ...ui(12.5, { weight: 700, color: C.ink }), flex: "none", whiteSpace: "nowrap" }}>
        {formatRupiah(subtotal + serviceFee)}
      </span>
    </div>
  );
}
