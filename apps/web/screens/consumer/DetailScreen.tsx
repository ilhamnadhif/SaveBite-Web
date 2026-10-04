"use client";

import { useEffect, useRef } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { discountPercent, formatRupiah, savings, type Bag, type Merchant } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { BottomScrim, FoodImage, SaveRibbon, StoreAvatar } from "../../ui/bagCards";
import { CircleIconButton, PrimaryButton } from "../../ui/buttons";
import { OverlayBadge, StatusBadge } from "../../ui/chips";
import { Gap, Screen, Scroll, Wrap, safeBottom, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, display, ui } from "../../ui/theme";

/** B4 Detail Bag. Full screen (own Scaffold). */
export function DetailScreen({ bag }: { bag: Bag }) {
  const state = useAppState();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fav = state.isFavorite(bag.merchant.id);
  const toggleFavorite = async () => {
    const added = await appState.toggleFavorite(bag.merchant.id);
    if (alive.current) snack(added ? "Ditambahkan ke favorit" : "Dihapus dari favorit");
  };

  return (
    <Screen background={C.cream}>
      <Scroll>
        <div style={{ position: "relative", height: 248, overflow: "hidden" }}>
          <FoodImage path={bag.image} priority />
          <BottomScrim stop={0.46} />
          <SaveRibbon text={`HEMAT ${discountPercent(bag)}%`} top={18} fontSize={12} padding="6px 44px" />
          <div style={{ position: "absolute", top: safeTop(6), left: 18 }}>
            <CircleIconButton semanticLabel="Kembali" onTap={() => void AppNav.back()}>
              <Icon name="arrow_back_ios_new" size={16} color={C.ink} />
            </CircleIconButton>
          </div>
          <div style={{ position: "absolute", top: safeTop(6), right: 18 }}>
            <CircleIconButton semanticLabel="Favorit" onTap={() => void toggleFavorite()}>
              <Icon name={fav ? "favorite" : "favorite_border"} size={18} color={C.terracotta} />
            </CircleIconButton>
          </div>
          <div style={{ position: "absolute", left: 18, bottom: 16, width: "max-content", display: "flex", alignItems: "center" }}>
            {bag.soldOut ? (
              <>
                <StatusBadge.neutral text="Habis" />
                <Gap w={9} />
              </>
            ) : null}
            <OverlayBadge text={`Sisa ${bag.quantityLeft} lagi`} />
            <Gap w={9} />
            <OverlayBadge text={`Isi senilai Rp${Math.trunc(bag.originalPrice / 1000)}rb+`} dark />
          </div>
        </div>
        <div style={{ padding: "18px 20px 0" }}>
          <MerchantRow merchant={bag.merchant} />
          <h1 style={{ ...display(24, { weight: 800 }), marginTop: 14, overflowWrap: "break-word" }}>{bag.title}</h1>
          <p style={{ ...ui(14, { color: C.body, height: 1.55 }), marginTop: 6, overflowWrap: "break-word" }}>
            {/* An empty Flutter Text still takes one line. */}
            {bag.description || "​"}
          </p>
          <div style={{ display: "flex", alignItems: "center", marginTop: 18 }}>
            <InfoCard label="Window pickup" value={`Hari ini ${bag.pickupWindow}`} valueColor={C.ink} />
            <Gap w={10} />
            <InfoCard label="Tersisa" value={`${bag.quantityLeft} bag lagi`} valueColor={C.terracotta} />
          </div>
          {bag.contents.length > 0 ? (
            <>
              <h2 style={{ ...ui(14, { weight: 700 }), marginTop: 18 }}>Mungkin ada di dalamnya</h2>
              <Wrap spacing={8} runSpacing={8} style={{ marginTop: 9 }}>
                {bag.contents.map((item, index) => (
                  <span
                    key={`${index}:${item}`}
                    style={{
                      padding: "7px 12px",
                      background: C.neutralChip,
                      borderRadius: 18,
                      ...ui(12.5, { weight: 600, color: C.body2 }),
                    }}
                  >
                    {item}
                  </span>
                ))}
              </Wrap>
            </>
          ) : null}
          <Gap h={18} />
        </div>
      </Scroll>
      <BottomBar bag={bag} />
    </Screen>
  );
}

function MerchantRow({ merchant }: { merchant: Merchant }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <StoreAvatar initial={merchant.initial} color={merchant.avatarColor} size={42} radius={12} />
      <Gap w={10} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...ui(15, { weight: 700 }), overflowWrap: "break-word" }}>{merchant.name}</div>
        <div style={{ ...ui(12.5, { color: C.body }), marginTop: 2 }}>
          {`★ ${merchant.rating.toFixed(1)} (${merchant.reviewCount}) · ${merchant.category} · ${merchant.distance}`}
        </div>
      </div>
      <button
        type="button"
        className="sb-tap"
        onClick={() => AppNav.toStoreProfile(merchant)}
        style={{ ...ui(13, { weight: 700, color: C.greenBright }), whiteSpace: "nowrap", flex: "none" }}
      >
        Lihat toko
      </button>
    </div>
  );
}

function InfoCard({ label, value, valueColor }: { label: string; value: string; valueColor: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: 12,
        background: C.white,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={ui(11.5, { weight: 600, color: C.muted })}>{label}</div>
      <div style={{ ...ui(14, { weight: 700, color: valueColor }), marginTop: 3 }}>{value}</div>
    </div>
  );
}

function BottomBar({ bag }: { bag: Bag }) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        background: C.white,
        borderTop: `1px solid ${C.border}`,
        paddingTop: 14,
        paddingRight: 20,
        paddingBottom: safeBottom(14),
        paddingLeft: 20,
      }}
    >
      <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <span style={{ ...display(23, { weight: 800, color: C.green }), whiteSpace: "nowrap" }}>
            {formatRupiah(bag.salePrice)}
          </span>
          <Gap w={7} />
          <span
            style={{
              ...ui(12, { color: C.strikethrough, decoration: "line-through", decorationColor: C.strikethrough }),
              whiteSpace: "nowrap",
            }}
          >
            {formatRupiah(bag.originalPrice)}
          </span>
        </div>
        <span style={{ ...ui(11.5, { weight: 700, color: C.greenAccent }), whiteSpace: "nowrap" }}>
          {`Kamu hemat ${formatRupiah(savings(bag))}`}
        </span>
      </div>
      <Gap w={14} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <PrimaryButton
          label={bag.soldOut ? "Bag habis" : "Pesan sekarang"}
          onTap={bag.soldOut ? null : () => AppNav.toCheckout(bag)}
        />
      </div>
    </div>
  );
}
