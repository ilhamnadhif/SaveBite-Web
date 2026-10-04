"use client";

import { useState, type CSSProperties } from "react";
import { type Bag, assetUrl, discountPercent, formatRupiah } from "../lib/models";
import { StatusBadge, OverlayBadge } from "./chips";
import { Icon } from "./Icon";
import { C, HERO_CARD_SHADOW, R, display, ellipsis, ui } from "./theme";

/**
 * `FoodImage`: tan placeholder, cover fit, optional desaturation, and an
 * error fallback. `path` is a Storage URL or a bundled image path.
 */
export function FoodImage({
  path,
  width,
  height,
  saturation = 1,
  fit = "cover",
  alt = "",
  style,
  priority = false,
}: {
  path: string;
  width?: number | string;
  height?: number | string;
  /** 1 = full colour, 0 = grayscale. */
  saturation?: number;
  fit?: "cover" | "contain";
  alt?: string;
  style?: CSSProperties;
  priority?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = assetUrl(path);
  const failed = failedSrc === src;
  return (
    <div
      style={{
        position: "relative",
        width: width ?? "100%",
        height: height ?? "100%",
        background: C.tanPlaceholder,
        overflow: "hidden",
        flex: "none",
        ...style,
      }}
    >
      {failed ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {path.startsWith("http") ? <Icon name="image_not_supported_outlined" color={C.muted} /> : null}
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: fit,
            filter: saturation < 1 ? `saturate(${saturation})` : undefined,
          }}
        />
      )}
    </div>
  );
}

/** Dark gradient from the bottom of a photo so badges stay legible. */
export function BottomScrim({ stop = 0.52 }: { stop?: number }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        background: `linear-gradient(to top, rgba(20, 12, 4, 0.5) 0%, rgba(20, 12, 4, 0) ${stop * 100}%)`,
        pointerEvents: "none",
      }}
    />
  );
}

/** Diagonal "HEMAT 67%" ribbon in the top-right corner of a photo. */
export function SaveRibbon({
  text,
  top = 15,
  fontSize = 11,
  padding = "5px 40px",
}: {
  text: string;
  top?: number;
  fontSize?: number;
  padding?: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top,
        right: -36,
        transform: "rotate(45deg)",
        background: C.terracotta,
        boxShadow: "0 3px 8px rgba(0, 0, 0, 0.25)",
        padding,
        whiteSpace: "nowrap",
        ...ui(fontSize, { weight: 800, color: C.white, letterSpacing: 0.6 }),
      }}
    >
      {text}
    </div>
  );
}

/** Sale price (Bricolage 800) + struck-through original price. */
export function PriceTag({
  salePrice,
  originalPrice,
  saleSize = 23,
  saleColor = C.green,
}: {
  salePrice: number;
  originalPrice: number;
  saleSize?: number;
  saleColor?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 9, minWidth: 0 }}>
      <span style={{ ...display(saleSize, { weight: 800, color: saleColor, height: 1 }), whiteSpace: "nowrap" }}>
        {formatRupiah(salePrice)}
      </span>
      <span
        style={{
          ...ui(13, { color: C.strikethrough, decoration: "line-through", decorationColor: C.strikethrough }),
          paddingBottom: 2,
          whiteSpace: "nowrap",
        }}
      >
        {formatRupiah(originalPrice)}
      </span>
    </div>
  );
}

/** "Selamatkan" label (green eco icon + text). */
export function SaveLabel() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flex: "none" }}>
      <Icon name="eco_outlined" size={15} color={C.greenAccent} />
      <span style={ui(12, { weight: 700, color: C.greenAccent })}>Selamatkan</span>
    </span>
  );
}

/** Store avatar: rounded square with the initial. */
export function StoreAvatar({
  initial,
  color,
  size = 28,
  radius,
  border = 0,
  borderColor = C.cream,
}: {
  initial: string;
  color: string;
  size?: number;
  radius?: number;
  border?: number;
  borderColor?: string;
}) {
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: "none",
        background: color,
        borderRadius: radius ?? size * 0.32,
        border: border > 0 ? `${border}px solid ${borderColor}` : undefined,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...display(size * 0.46, { weight: 800, color: C.white, height: 1 }),
      }}
    >
      {initial}
    </div>
  );
}

const rating = (value: number) => value.toFixed(1);

function MerchantLine({ bag }: { bag: Bag }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <StoreAvatar initial={bag.merchant.initial} color={bag.merchant.avatarColor} />
      <span style={{ ...ui(14, { weight: 700 }), ...ellipsis, flex: "0 1 auto" }}>{bag.merchant.name}</span>
      <span style={{ ...ui(12, { weight: 600, color: C.body }), whiteSpace: "nowrap", flex: "none" }}>
        {`★ ${rating(bag.merchant.rating)} · ${bag.merchant.distance}`}
      </span>
    </div>
  );
}

/** Large home card (big photo + save ribbon + badges). */
export function BagHeroCard({ bag, onTap }: { bag: Bag; onTap?: () => void }) {
  return (
    <button
      type="button"
      className="sb-tap"
      onClick={onTap}
      aria-label={`${bag.title} dari ${bag.merchant.name}`}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: C.white,
        borderRadius: R.card,
        border: `1px solid ${C.borderAlt}`,
        boxShadow: HERO_CARD_SHADOW,
        overflow: "hidden",
      }}
    >
      <div style={{ position: "relative", height: 174, overflow: "hidden" }}>
        <FoodImage path={bag.image} />
        <BottomScrim />
        <SaveRibbon text={`HEMAT ${discountPercent(bag)}%`} />
        <div style={{ position: "absolute", left: 11, right: 11, bottom: 11, display: "flex", gap: 8, alignItems: "center" }}>
          <OverlayBadge text={`Sisa ${bag.quantityLeft} lagi`} />
          <span style={{ flex: 1 }} />
          <OverlayBadge text={`Ambil ${bag.pickupWindow}`} dark />
        </div>
      </div>
      <div style={{ padding: "14px 15px 16px" }}>
        <MerchantLine bag={bag} />
        <div style={{ ...display(17, { weight: 700, letterSpacing: -0.3 }), marginTop: 8 }}>{bag.title}</div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 10, gap: 8 }}>
          <PriceTag salePrice={bag.salePrice} originalPrice={bag.originalPrice} />
          <span style={{ flex: 1 }} />
          <SaveLabel />
        </div>
      </div>
    </button>
  );
}

/** Compact home card (smaller photo + "Hemat X%" badge). */
export function BagCompactCard({ bag, onTap }: { bag: Bag; onTap?: () => void }) {
  return (
    <button
      type="button"
      className="sb-tap"
      onClick={onTap}
      aria-label={`${bag.title} dari ${bag.merchant.name}`}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: C.white,
        borderRadius: R.card,
        border: `1px solid ${C.borderAlt}`,
        overflow: "hidden",
      }}
    >
      <div style={{ position: "relative", height: 124, overflow: "hidden" }}>
        <FoodImage path={bag.image} />
        <BottomScrim />
        <div style={{ position: "absolute", left: 11, right: 11, bottom: 11, display: "flex", gap: 8, alignItems: "center" }}>
          <OverlayBadge text={`Sisa ${bag.quantityLeft} lagi`} lightForeground={C.greenAccent} />
          <span style={{ flex: 1 }} />
          <OverlayBadge text={`Ambil ${bag.pickupWindow}`} dark />
        </div>
      </div>
      <div style={{ padding: "14px 15px 16px" }}>
        <MerchantLine bag={bag} />
        <div style={{ ...display(16, { weight: 700, letterSpacing: -0.3 }), marginTop: 8 }}>{bag.title}</div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 10, gap: 8 }}>
          <PriceTag salePrice={bag.salePrice} originalPrice={bag.originalPrice} saleSize={21} />
          <span style={{ flex: 1 }} />
          <StatusBadge.save text={`Hemat ${discountPercent(bag)}%`} />
        </div>
      </div>
    </button>
  );
}
