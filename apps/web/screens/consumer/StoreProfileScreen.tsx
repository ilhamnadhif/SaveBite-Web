"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import { assetUrl, formatRupiah, type Bag, type Merchant } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FoodImage, StoreAvatar } from "../../ui/bagCards";
import { CircleIconButton, TextButton } from "../../ui/buttons";
import { Gap, InfoBanner, Screen, Scroll, SectionHeading, Spinner, Wrap, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, display, ui } from "../../ui/theme";

/** B10 Profil Toko. Full screen (own Scaffold), scrollable. */
export function StoreProfileScreen({ merchant }: { merchant: Merchant }) {
  const state = useAppState();
  const [bags, setBags] = useState<Bag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const alive = useRef(true);
  const merchantId = merchant.id;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadBags = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await appState.bagsByMerchant(merchantId);
      if (!alive.current) return;
      setBags(result);
      setLoading(false);
    } catch (error) {
      if (!alive.current) return;
      setLoading(false);
      setLoadError(
        error instanceof BackendException
          ? error.message
          : "Daftar Surprise Bag belum dapat dimuat. Periksa koneksi lalu coba lagi.",
      );
    }
  }, [merchantId]);

  useEffect(() => {
    void loadBags();
  }, [loadBags]);

  const fav = state.isFavorite(merchant.id);
  const toggleFavorite = async () => {
    const added = await appState.toggleFavorite(merchant.id);
    if (alive.current) snack(added ? "Ditambahkan ke favorit" : "Dihapus dari favorit");
  };

  return (
    <Screen background={C.cream}>
      <Scroll>
        <div style={{ position: "relative", height: 170, overflow: "hidden" }}>
          <FoodImage path={merchant.coverImage} priority />
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
        </div>
        {/*
          Header and body use Transform.translate(0, -34): both are drawn 34 px
          higher (the avatar overlaps the cover) while the list keeps its full
          extent — hence the header's -34 margin and the trailing 34 px.
        */}
        <HeaderInfo merchant={merchant} />
        <div style={{ padding: "18px 20px 0" }}>
          <InfoBanner icon="home_outlined">
            <p style={ui(13, { weight: 600, color: C.greenAccent })}>
              {"Toko ini sudah menyelamatkan "}
              <span style={ui(13, { weight: 700, color: C.greenAccent })}>{`${merchant.bagsSaved} bag`}</span>
              {" makanan."}
            </p>
          </InfoBanner>
          <Gap h={20} />
          <SectionHeading title="Surprise Bag tersedia" />
          <Gap h={12} />
          {loading ? (
            <div style={{ padding: "24px 0", display: "flex", justifyContent: "center" }}>
              <Spinner label="Memuat" />
            </div>
          ) : loadError !== null ? (
            <div
              style={{
                width: "100%",
                padding: 18,
                background: C.white,
                borderRadius: 16,
                border: `1px solid ${C.border}`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <Icon name="cloud_off_outlined" size={30} color={C.muted} />
              <p style={{ ...ui(13, { color: C.body, height: 1.45 }), marginTop: 9, textAlign: "center" }}>{loadError}</p>
              <Gap h={10} />
              <TextButton label="Coba lagi" icon="refresh" iconSize={17} onTap={() => void loadBags()} />
            </div>
          ) : bags.length === 0 ? (
            <p style={ui(13, { color: C.body })}>Belum ada bag tersedia</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {bags.map((bag) => (
                <BagCard key={bag.id} bag={bag} />
              ))}
            </div>
          )}
          <Gap h={24} />
        </div>
        <Gap h={34} />
      </Scroll>
    </Screen>
  );
}

function HeaderInfo({ merchant }: { merchant: Merchant }) {
  const detail = ui(13, { color: C.body });
  return (
    // Positioned so it paints over the (positioned) cover it overlaps.
    <div style={{ position: "relative", marginTop: -34, padding: "0 20px" }}>
      <StoreAvatar
        initial={merchant.initial}
        color={merchant.avatarColor}
        size={72}
        radius={20}
        border={4}
        borderColor={C.cream}
      />
      <h1 style={{ ...display(22, { weight: 800, color: C.ink }), marginTop: 12, overflowWrap: "break-word" }}>
        {merchant.name}
      </h1>
      <Wrap spacing={10} runSpacing={4} style={{ alignItems: "center", marginTop: 5 }}>
        <span style={ui(13, { weight: 700, color: C.amber })}>{`★ ${merchant.rating.toFixed(1)}`}</span>
        <span style={detail}>{`(${merchant.reviewCount} ulasan)`}</span>
        <span style={detail}>·</span>
        <span style={detail}>{merchant.category}</span>
        <span style={detail}>·</span>
        <span style={detail}>{merchant.distance}</span>
      </Wrap>
      <div style={{ display: "flex", alignItems: "center", marginTop: 10 }}>
        <Icon name="location_on_outlined" size={14} color={C.greenBright} />
        <Gap w={7} />
        <span style={{ ...detail, flex: 1, minWidth: 0, overflowWrap: "break-word" }}>
          {`${merchant.address} · Buka ${merchant.hours}`}
        </span>
      </div>
    </div>
  );
}

function BagCard({ bag }: { bag: Bag }) {
  return (
    <button
      type="button"
      className="sb-tap"
      onClick={() => AppNav.toDetail(bag)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "stretch",
        textAlign: "left",
        background: C.white,
        borderRadius: 18,
        border: `1px solid ${C.border}`,
        overflow: "hidden",
      }}
    >
      <CardPhoto path={bag.image} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: 13,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <span style={{ ...ui(14, { weight: 700, color: C.ink }), overflowWrap: "break-word" }}>{bag.title}</span>
        <span style={{ ...ui(12, { color: C.body }), marginTop: 3 }}>
          {`Ambil ${bag.pickupWindow} · sisa ${bag.quantityLeft}`}
        </span>
        <Wrap spacing={7} runSpacing={2} style={{ alignItems: "center", marginTop: 8 }}>
          <span style={ui(12, { color: C.strikethrough, decoration: "line-through", decorationColor: C.strikethrough })}>
            {formatRupiah(bag.originalPrice)}
          </span>
          <span style={display(17, { weight: 800, color: C.greenBright })}>{formatRupiah(bag.salePrice)}</span>
        </Wrap>
      </span>
    </button>
  );
}

/**
 * `IntrinsicHeight` + `SizedBox(width: 104, child: FoodImage(bag.image))` with
 * `CrossAxisAlignment.stretch`: once the photo loads, its natural aspect ratio
 * at 104 px sets the card's minimum height, and the photo covers the full
 * height when the text column is taller. Same placeholder and error fallback
 * as {@link FoodImage}.
 */
function CardPhoto({ path }: { path: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = assetUrl(path);
  if (failedSrc === src) {
    return (
      <span
        style={{
          width: 104,
          flex: "none",
          background: C.tanPlaceholder,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {path.startsWith("http") ? <Icon name="image_not_supported_outlined" color={C.muted} /> : null}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      style={{ width: 104, flex: "none", objectFit: "cover", background: C.tanPlaceholder }}
    />
  );
}
