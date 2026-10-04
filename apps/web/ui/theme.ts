import type { CSSProperties } from "react";

/**
 * SaveBite design tokens, ported 1:1 from the Flutter app
 * (`lib/theme/app_colors.dart`, `app_text.dart`, `app_theme.dart`).
 *
 * Screens are ported line by line from Dart, so the API mirrors Flutter:
 * `AppColors.green` → `C.green`, `AppText.display(17, weight: 700)` →
 * `display(17, { weight: 700 })`, `AppText.ui(13, color: AppColors.body)` →
 * `ui(13, { color: C.body })`.
 */
export const C = {
  // Backgrounds
  cream: "#FBF7EF",
  galleryBg: "#E7E1D4",
  tanPlaceholder: "#E7DDC8",

  // Hijau (konsumen / brand)
  green: "#0F3D2C",
  greenDark: "#16442F",
  greenBright: "#27A36A",
  greenAccent: "#1E8456",
  greenSoftBg: "#E8F3EC",
  greenSoftBorder: "#C9E3D2",
  greenMuted: "#9FC9B2",
  greenMutedDeep: "#5C7E6C",

  // Merchant (terakota / cokelat)
  brown: "#8A3A14",
  brownCard: "#9C4720",
  terracotta: "#E2592B",
  terracottaSoftBg: "#FBEFDD",
  terracottaSoftBorder: "#F0DDB9",
  terracottaText: "#7A5536",
  merchantMuted: "#F0C9A8",

  // Savings
  saveBg: "#FBE9DF",
  saveText: "#C2410C",

  // Gold / amber
  amber: "#EFA63C",
  amberAvatar: "#F2A33C",
  goldOnDark: "#EFC07A",

  // Teks
  ink: "#16231C",
  body: "#5C685F",
  body2: "#4F6157",
  body3: "#4A574F",
  muted: "#8A958C",
  mutedAlt: "#9BA39B",
  navInactive: "#A0A89F",
  strikethrough: "#A39B89",
  captionWarm: "#9B8E72",
  emptyIcon: "#B7AE9B",

  // Border & garis
  border: "#F0EADB",
  borderAlt: "#ECE4D3",
  divider: "#F4EEE0",
  inputBorder: "#E3D9C5",
  chipBorder: "#E7DDC8",
  handle: "#D7CFBE",
  rule: "#D2CABA",
  chevron: "#C8C0AE",

  // Chip / netral
  neutralChip: "#F1ECE0",
  neutralChip2: "#EEF0EC",
  emptyCircle: "#EEEAE0",

  // Error / danger
  danger: "#C24420",
  dangerBg: "#FBE4DB",
  dangerSoftBg: "#FBE8E2",
  dangerTintBg: "#FBEDE6",
  ratingBg: "#FCEFE9",

  // Scanner (gelap)
  scanBg: "#101512",
  scanCard: "#1B221D",
  scanCardBorder: "#2A332C",
  scanMuted: "#9FB3A6",

  // Peta
  mapBg: "#E6E9E0",
  mapGrid: "#DCE2D6",
  mapGridBg: "#E9ECE3",
  mapRoad: "#CFD8C6",

  // Brand pembayaran / aksen
  userDot: "#2D7BE5",
  bca: "#005BAA",
  gopay: "#00AA13",
  ovo: "#4C2A86",

  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
} as const;

export type ColorName = keyof typeof C;

/**
 * Converts a Flutter ARGB literal (`Color(0x8C0F231C)`) to CSS. Use it when
 * porting a raw `Color(0x…)` from Dart so the alpha channel survives exactly.
 */
export function argb(value: number): string {
  const a = ((value >>> 24) & 0xff) / 255;
  const r = (value >>> 16) & 0xff;
  const g = (value >>> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

/** Same as Flutter's `color.withValues(alpha: x)` / `withOpacity(x)`. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type Weight = 400 | 500 | 600 | 700 | 800;

type DisplayOptions = {
  weight?: Weight;
  color?: string;
  /** Flutter `height`: a line-height multiplier. */
  height?: number;
  letterSpacing?: number;
};

type UiOptions = {
  weight?: Weight;
  color?: string;
  height?: number;
  letterSpacing?: number;
  decoration?: "line-through" | "underline";
  decorationColor?: string;
};

export const FONT_DISPLAY = "var(--font-display), 'Bricolage Grotesque', system-ui, sans-serif";
export const FONT_UI = "var(--font-ui), 'Plus Jakarta Sans', system-ui, sans-serif";

/** `AppText.display` — Bricolage Grotesque, judul. */
export function display(size: number, options: DisplayOptions = {}): CSSProperties {
  const { weight = 800, color = C.ink, height, letterSpacing = -0.5 } = options;
  return {
    fontFamily: FONT_DISPLAY,
    fontSize: size,
    fontWeight: weight,
    color,
    lineHeight: height ?? "normal",
    letterSpacing,
  };
}

/** `AppText.ui` — Plus Jakarta Sans, UI/body. */
export function ui(size: number, options: UiOptions = {}): CSSProperties {
  const { weight = 500, color = C.ink, height, letterSpacing = 0, decoration, decorationColor } = options;
  return {
    fontFamily: FONT_UI,
    fontSize: size,
    fontWeight: weight,
    color,
    lineHeight: height ?? "normal",
    letterSpacing,
    ...(decoration ? { textDecorationLine: decoration, textDecorationColor: decorationColor ?? color } : {}),
  };
}

/** `AppRadius`. */
export const R = {
  card: 22,
  cardSm: 18,
  button: 16,
  input: 14,
  pill: 20,
  sheet: 28,
} as const;

/** `AppSpacing`. */
export const S = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** `kHeroCardShadow` — 0 12px 28px -18px rgba(40,30,12,0.5). */
export const HERO_CARD_SHADOW = "0 12px 28px -18px rgba(40, 30, 12, 0.5)";

/** `kSheetShadow`. */
export const SHEET_SHADOW = "0 8px 30px rgba(0, 0, 0, 0.15)";

/** Modal barrier used by every `showModalBottomSheet` in AppNav (0x8C0F231C). */
export const SHEET_BARRIER = argb(0x8c0f231c);

/** Single-line ellipsis, i.e. `maxLines: 1, overflow: TextOverflow.ellipsis`. */
export const ellipsis: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

/** Multi-line clamp, i.e. `maxLines: n, overflow: TextOverflow.ellipsis`. */
export function clamp(lines: number): CSSProperties {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    minWidth: 0,
  };
}
