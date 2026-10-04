"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { C, R, ui } from "./theme";

/**
 * Buttons from `lib/widgets/buttons.dart`, plus the Material buttons the
 * Flutter screens use directly (TextButton, OutlinedButton, FilledButton,
 * IconButton). A missing `onTap` means disabled, exactly like Flutter.
 */

/**
 * Material 3 roles Flutter derives from the app's seed colour
 * (`ColorScheme.fromSeed(seedColor: AppColors.green)`).
 */
const M3 = {
  outline: "#707973",
  onSurfaceVariant: "#404944",
  disabledForeground: "rgba(23, 29, 26, 0.38)",
  disabledContainer: "rgba(23, 29, 26, 0.12)",
} as const;

type PrimaryButtonProps = {
  label: string;
  onTap?: (() => void) | null;
  background?: string;
  foreground?: string;
  height?: number;
  fontSize?: number;
  icon?: ReactNode;
  /** `PrimaryButton.merchant(...)`: terracotta with white text. */
  merchant?: boolean;
  type?: "button" | "submit";
  style?: CSSProperties;
  ariaLabel?: string;
};

/** Full-width pill button (h54, r16, weight 700) with press scale. */
export function PrimaryButton({
  label,
  onTap,
  background,
  foreground,
  height = 54,
  fontSize = 16,
  icon,
  merchant = false,
  type = "button",
  style,
  ariaLabel,
}: PrimaryButtonProps) {
  const enabled = Boolean(onTap) || type === "submit";
  const bg = background ?? (merchant ? C.terracotta : C.green);
  const fg = foreground ?? (merchant ? C.white : C.cream);
  return (
    <button
      type={type}
      className="sb-press"
      disabled={!enabled}
      aria-label={ariaLabel}
      onClick={onTap ? () => onTap() : undefined}
      style={{
        width: "100%",
        height,
        borderRadius: R.button,
        background: bg,
        color: fg,
        opacity: enabled ? 1 : 0.5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        padding: "0 16px",
        flex: "none",
        ...style,
      }}
    >
      {icon}
      <span
        style={{
          ...ui(fontSize, { weight: 700, color: fg }),
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {label}
      </span>
    </button>
  );
}

type GhostButtonProps = {
  label: string;
  onTap?: (() => void) | null;
  color?: string;
  height?: number;
  fontSize?: number;
  style?: CSSProperties;
};

/** Plain text button, full width (e.g. "Batalkan pesanan"). */
export function GhostButton({ label, onTap, color = C.body, height = 50, fontSize = 15, style }: GhostButtonProps) {
  const enabled = Boolean(onTap);
  return (
    <button
      type="button"
      className="sb-ink"
      disabled={!enabled}
      onClick={onTap ? () => onTap() : undefined}
      style={{
        width: "100%",
        height,
        borderRadius: R.button,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // The Dart label has an explicit colour, so it does not dim when
        // the button is disabled.
        flex: "none",
        ...style,
      }}
    >
      <span style={ui(fontSize, { weight: 700, color })}>{label}</span>
    </button>
  );
}

type CircleIconButtonProps = {
  children: ReactNode;
  onTap?: (() => void) | null;
  size?: number;
  background?: string;
  semanticLabel?: string;
  style?: CSSProperties;
};

/** Round button (back / favourite over a photo). Default bg is white @ 92%. */
export function CircleIconButton({
  children,
  onTap,
  size = 38,
  background = "rgba(255, 255, 255, 0.922)",
  semanticLabel,
  style,
}: CircleIconButtonProps) {
  return (
    <button
      type="button"
      className="sb-tap"
      aria-label={semanticLabel}
      disabled={!onTap}
      onClick={onTap ? () => onTap() : undefined}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Header back chevron. `onTap` defaults to the navigator's back. */
export function BackChevron({ onTap, color = C.ink }: { onTap: () => void; color?: string }) {
  return (
    <button
      type="button"
      className="sb-tap"
      aria-label="Kembali"
      onClick={onTap}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 4, margin: -4 }}
    >
      <Icon name="arrow_back_ios_new" size={18} color={color} />
    </button>
  );
}

type MaterialButtonProps = {
  label: ReactNode;
  onTap?: (() => void) | null;
  icon?: IconName | ReactNode;
  color?: string;
  iconSize?: number;
  fontSize?: number;
  fontWeight?: 400 | 500 | 600 | 700 | 800;
  style?: CSSProperties;
  ariaLabel?: string;
  type?: "button" | "submit";
};

function renderIcon(icon: MaterialButtonProps["icon"], size: number, color: string) {
  if (!icon) return null;
  if (typeof icon === "string") return <Icon name={icon as IconName} size={size} color={color} />;
  return icon;
}

/** Material 3 `TextButton` / `TextButton.icon` (primary = brand green). */
export function TextButton({
  label,
  onTap,
  icon,
  color = C.green,
  iconSize = 18,
  fontSize = 14,
  fontWeight = 500,
  style,
  ariaLabel,
  type = "button",
}: MaterialButtonProps) {
  const enabled = Boolean(onTap) || type === "submit";
  const fg = enabled ? color : M3.disabledForeground;
  return (
    <button
      type={type}
      className="sb-ink"
      disabled={!enabled}
      aria-label={ariaLabel}
      onClick={onTap ? () => onTap() : undefined}
      style={{
        // Material 3: minimum 64x40 inside a padded 48px tap target.
        minHeight: 40,
        minWidth: 64,
        margin: "4px 0",
        padding: icon ? "0 16px 0 12px" : "0 12px",
        borderRadius: 20,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        ...ui(fontSize, { weight: fontWeight, color: fg, letterSpacing: 0.1 }),
        ...style,
      }}
    >
      {renderIcon(icon, iconSize, fg)}
      {label}
    </button>
  );
}

/** Material 3 `OutlinedButton` / `OutlinedButton.icon`. */
export function OutlinedButton({
  label,
  onTap,
  icon,
  color = C.green,
  borderColor = M3.outline,
  iconSize = 18,
  fontSize = 14,
  fontWeight = 500,
  style,
  ariaLabel,
  type = "button",
}: MaterialButtonProps & { borderColor?: string }) {
  const enabled = Boolean(onTap) || type === "submit";
  const fg = enabled ? color : M3.disabledForeground;
  return (
    <button
      type={type}
      className="sb-ink"
      disabled={!enabled}
      aria-label={ariaLabel}
      onClick={onTap ? () => onTap() : undefined}
      style={{
        minHeight: 40,
        minWidth: 64,
        margin: "4px 0",
        padding: icon ? "0 24px 0 16px" : "0 24px",
        borderRadius: 20,
        border: `1px solid ${enabled ? borderColor : M3.disabledContainer}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        ...ui(fontSize, { weight: fontWeight, color: fg, letterSpacing: 0.1 }),
        ...style,
      }}
    >
      {renderIcon(icon, iconSize, fg)}
      {label}
    </button>
  );
}

/** Material 3 `FilledButton` / `FilledButton.icon`. */
export function FilledButton({
  label,
  onTap,
  icon,
  color = C.green,
  foreground = C.white,
  iconSize = 18,
  fontSize = 14,
  fontWeight = 500,
  style,
  ariaLabel,
  type = "button",
}: MaterialButtonProps & { foreground?: string }) {
  const enabled = Boolean(onTap) || type === "submit";
  return (
    <button
      type={type}
      className="sb-press"
      disabled={!enabled}
      aria-label={ariaLabel}
      onClick={onTap ? () => onTap() : undefined}
      style={{
        minHeight: 40,
        minWidth: 64,
        margin: "4px 0",
        padding: icon ? "0 24px 0 16px" : "0 24px",
        borderRadius: 20,
        background: enabled ? color : M3.disabledContainer,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        ...ui(fontSize, { weight: fontWeight, color: enabled ? foreground : M3.disabledForeground, letterSpacing: 0.1 }),
        ...style,
      }}
    >
      {renderIcon(icon, iconSize, enabled ? foreground : M3.disabledForeground)}
      {label}
    </button>
  );
}

type IconButtonProps = {
  icon: IconName | ReactNode;
  onTap?: (() => void) | null;
  /** Flutter `tooltip`, also the accessible name. */
  tooltip: string;
  color?: string;
  size?: number;
  style?: CSSProperties;
};

/** Material `IconButton` (48px target, 24px icon). */
export function IconButton({ icon, onTap, tooltip, color = M3.onSurfaceVariant, size = 24, style }: IconButtonProps) {
  const enabled = Boolean(onTap);
  const fg = enabled ? color : M3.disabledForeground;
  return (
    <button
      type="button"
      className="sb-ink"
      title={tooltip}
      aria-label={tooltip}
      disabled={!enabled}
      onClick={onTap ? () => onTap() : undefined}
      style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        ...style,
      }}
    >
      {renderIcon(icon, size, fg)}
    </button>
  );
}
