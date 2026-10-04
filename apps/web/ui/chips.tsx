"use client";

import type { CSSProperties } from "react";
import { C, ui, type Weight } from "./theme";

/** `SelectChip`: selected = solid, otherwise white outline. */
export function SelectChip({
  label,
  selected = false,
  onTap,
  selectedColor = C.green,
  padding = "8px 14px",
  fontSize = 13,
  style,
}: {
  label: string;
  selected?: boolean;
  onTap?: () => void;
  selectedColor?: string;
  padding?: string;
  fontSize?: number;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className="sb-tap"
      aria-pressed={selected}
      onClick={onTap}
      style={{
        padding,
        flex: "none",
        background: selected ? selectedColor : C.white,
        borderRadius: 20,
        border: selected ? "1px solid transparent" : `1px solid ${C.chipBorder}`,
        transition: "background-color 150ms ease, border-color 150ms ease",
        whiteSpace: "nowrap",
        ...ui(fontSize, { weight: selected ? 700 : 600, color: selected ? C.white : C.body2 }),
        ...style,
      }}
    >
      {label}
    </button>
  );
}

type BadgeProps = {
  text: string;
  background: string;
  foreground: string;
  fontSize?: number;
  weight?: Weight;
  padding?: string;
  style?: CSSProperties;
};

/** `StatusBadge` with free colours; use the presets below for common states. */
export function StatusBadge({
  text,
  background,
  foreground,
  fontSize = 11,
  weight = 800,
  padding = "4px 10px",
  style,
}: BadgeProps) {
  return (
    <span
      style={{
        display: "inline-block",
        padding,
        background,
        borderRadius: 20,
        whiteSpace: "nowrap",
        flex: "none",
        ...ui(fontSize, { weight, color: foreground }),
        ...style,
      }}
    >
      {text}
    </span>
  );
}

type PresetProps = { text: string; style?: CSSProperties; fontSize?: number };

/** `StatusBadge.available`. */
StatusBadge.available = function Available({ text, style, fontSize }: PresetProps) {
  return <StatusBadge text={text} background={C.greenSoftBg} foreground={C.greenAccent} weight={700} style={style} fontSize={fontSize} />;
};
/** `StatusBadge.waiting`. */
StatusBadge.waiting = function Waiting({ text, style, fontSize }: PresetProps) {
  return <StatusBadge text={text} background={C.terracottaSoftBg} foreground={C.brown} style={style} fontSize={fontSize} />;
};
/** `StatusBadge.done`. */
StatusBadge.done = function Done({ text, style, fontSize }: PresetProps) {
  return <StatusBadge text={text} background={C.neutralChip2} foreground={C.body} weight={700} style={style} fontSize={fontSize} />;
};
/** `StatusBadge.expired`. */
StatusBadge.expired = function Expired({ text, style, fontSize }: PresetProps) {
  return <StatusBadge text={text} background={C.dangerSoftBg} foreground={C.danger} weight={700} style={style} fontSize={fontSize} />;
};
/** `StatusBadge.neutral`. */
StatusBadge.neutral = function Neutral({ text, style, fontSize }: PresetProps) {
  return <StatusBadge text={text} background={C.neutralChip} foreground={C.muted} weight={700} style={style} fontSize={fontSize} />;
};
/** `StatusBadge.save`. */
StatusBadge.save = function Save({ text, style, fontSize }: PresetProps) {
  return <StatusBadge text={text} background={C.saveBg} foreground={C.saveText} style={style} fontSize={fontSize} />;
};

/**
 * `OverlayBadge`, the badge over a photo: "Sisa 3 lagi" (white) and
 * "Ambil 20.00–21.00" (`dark`: deep green + gold text).
 */
export function OverlayBadge({
  text,
  dark = false,
  lightForeground = C.saveText,
}: {
  text: string;
  dark?: boolean;
  lightForeground?: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "5px 11px",
        background: dark ? "rgba(15, 61, 44, 0.859)" : "rgba(255, 255, 255, 0.949)",
        borderRadius: 20,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
        ...ui(11, { weight: dark ? 700 : 800, color: dark ? C.goldOnDark : lightForeground }),
      }}
    >
      {text}
    </span>
  );
}
