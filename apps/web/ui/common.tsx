"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { navigator } from "../lib/navigator";
import { Icon, type IconName } from "./Icon";
import { C, R, display, ellipsis, ui } from "./theme";

/**
 * Widgets from `lib/widgets/common.dart`, plus the small Material pieces the
 * Flutter screens use directly. Layout primitives first, then widgets.
 */

/* ------------------------------------------------------------------------- *
 * Safe-area helpers. Flutter's `MediaQuery.padding.top/bottom` is the notch /
 * home indicator inset; on the web that is `env(safe-area-inset-*)`.
 * ------------------------------------------------------------------------- */

/** `topInset + px` → CSS length. */
export const safeTop = (px = 0) => `calc(${px}px + var(--safe-top))`;
/** `bottomInset + px` → CSS length. */
export const safeBottom = (px = 0) => `calc(${px}px + var(--safe-bottom))`;

type DivProps = HTMLAttributes<HTMLDivElement> & { style?: CSSProperties };

/**
 * A full screen (`Scaffold`): a flex column that fills its navigator layer.
 * Put the header first, a `<Scroll>` in the middle, and a bottom bar last —
 * the `Column([header, Expanded(scroll), SafeArea(bottomBar)])` pattern.
 */
export function Screen({ background = C.cream, style, children, ...rest }: DivProps & { background?: string }) {
  return (
    <div
      {...rest}
      style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, height: "100%", background, ...style }}
    >
      {children}
    </div>
  );
}

/** The `Expanded(child: ListView/SingleChildScrollView)` of a screen. */
export function Scroll({ style, children, className = "", ...rest }: DivProps) {
  return (
    <div {...rest} className={`sb-scroll ${className}`} style={style}>
      {children}
    </div>
  );
}

/**
 * `RefreshIndicator` + scroll view. Pull down at the top (touch) to refresh;
 * the spinner stays until `onRefresh` settles.
 */
export function RefreshScroll({
  onRefresh,
  color = C.greenBright,
  style,
  children,
  className = "",
  ...rest
}: DivProps & { onRefresh: () => Promise<unknown> | void; color?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const threshold = 72;
    let current = 0;
    let busy = false;

    const onStart = (event: TouchEvent) => {
      if (busy || element.scrollTop > 0) {
        start.current = null;
        return;
      }
      start.current = event.touches[0]?.clientY ?? null;
    };
    const onMove = (event: TouchEvent) => {
      if (start.current === null || busy) return;
      const delta = (event.touches[0]?.clientY ?? start.current) - start.current;
      if (delta <= 0 || element.scrollTop > 0) {
        current = 0;
        setPull(0);
        return;
      }
      current = Math.min(110, delta * 0.5);
      setPull(current);
      if (event.cancelable && delta > 8) event.preventDefault();
    };
    const onEnd = () => {
      if (start.current === null || busy) return;
      start.current = null;
      if (current >= threshold * 0.75) {
        busy = true;
        setRefreshing(true);
        setPull(56);
        void Promise.resolve()
          .then(() => refreshRef.current())
          .catch(() => undefined)
          .finally(() => {
            busy = false;
            current = 0;
            setRefreshing(false);
            setPull(0);
          });
      } else {
        current = 0;
        setPull(0);
      }
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onEnd);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    <div {...rest} ref={ref} className={`sb-scroll ${className}`} style={{ position: "relative", ...style }}>
      <div
        aria-hidden={!refreshing}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 0,
          display: "flex",
          justifyContent: "center",
          zIndex: 5,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            marginTop: Math.max(0, pull - 44),
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: C.white,
            boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
            display: pull > 4 || refreshing ? "flex" : "none",
            alignItems: "center",
            justifyContent: "center",
            transform: refreshing ? undefined : `rotate(${pull * 4}deg)`,
          }}
        >
          {refreshing ? <Spinner size={20} strokeWidth={2.5} color={color} /> : <Icon name="refresh" size={22} color={color} />}
        </div>
      </div>
      <div style={{ transform: pull ? `translateY(${pull * 0.6}px)` : undefined, transition: start.current === null ? "transform 180ms ease" : undefined }}>
        {children}
      </div>
    </div>
  );
}

/** `SizedBox(height:)` / `SizedBox(width:)`. */
export function Gap({ h, w }: { h?: number; w?: number }) {
  return <div aria-hidden style={{ flex: "none", height: h ?? 0, width: w ?? 0 }} />;
}

/** `Spacer()` / `Expanded(SizedBox())`. */
export function Spacer() {
  return <div aria-hidden style={{ flex: "1 1 auto" }} />;
}

/* ------------------------------------------------------------------------- *
 * Widgets
 * ------------------------------------------------------------------------- */

/** Grey handle at the top of a bottom sheet. */
export function SheetHandle() {
  return (
    <div
      aria-hidden
      style={{ width: 42, height: 5, marginBottom: 20, background: C.handle, borderRadius: 3, alignSelf: "center", flex: "none" }}
    />
  );
}

/** Coloured header that extends under the status bar (e.g. green home). */
export function ColoredHeader({
  background,
  children,
  bottomPadding = 16,
  horizontalPadding = 20,
  style,
}: {
  background: string;
  children: ReactNode;
  bottomPadding?: number;
  horizontalPadding?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: "100%",
        flex: "none",
        background,
        paddingTop: safeTop(14),
        paddingRight: horizontalPadding,
        paddingBottom: bottomPadding,
        paddingLeft: horizontalPadding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** White header with a back chevron and a Bricolage 19 title. */
export function SimpleHeader({
  title,
  onBack,
  trailing,
  background = C.white,
  showBack = true,
  titleSize = 19,
}: {
  title: string;
  onBack?: () => void;
  trailing?: ReactNode;
  background?: string;
  showBack?: boolean;
  titleSize?: number;
}) {
  return (
    <div
      style={{
        flex: "none",
        background,
        paddingTop: safeTop(12),
        paddingRight: 20,
        paddingBottom: 14,
        paddingLeft: 20,
        display: "flex",
        alignItems: "center",
        minHeight: 0,
      }}
    >
      {showBack ? (
        <>
          <button
            type="button"
            className="sb-tap"
            aria-label="Kembali"
            onClick={onBack ?? (() => void navigator.maybePop())}
            style={{ display: "flex", padding: 4, margin: -4 }}
          >
            <Icon name="arrow_back_ios_new" size={18} color={C.ink} />
          </button>
          <div style={{ width: 14, flex: "none" }} />
        </>
      ) : null}
      <h1 style={{ ...display(titleSize, { weight: 700, letterSpacing: -0.3 }), flex: 1, minWidth: 0 }}>{title}</h1>
      {trailing}
    </div>
  );
}

/** Small label above a form field. */
export function FieldLabel({ children, htmlFor, style }: { children: ReactNode; htmlFor?: string; style?: CSSProperties }) {
  return (
    <label htmlFor={htmlFor} style={{ display: "block", paddingBottom: 7, ...ui(12.5, { weight: 700, color: C.body }), ...style }}>
      {children}
    </label>
  );
}

type FieldBaseProps = {
  borderColor?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Shows the danger border (Flutter `errorText` present). */
  invalid?: boolean;
  containerStyle?: CSSProperties;
  background?: string;
};

/** SaveBite text field (border 1.5, r14, h-padding 14). Controlled. */
export function AppTextField({
  borderColor = C.inputBorder,
  leading,
  trailing,
  invalid = false,
  containerStyle,
  background = C.white,
  style,
  ...input
}: FieldBaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div
      className="sb-field"
      data-error={invalid ? "true" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background,
        borderRadius: R.input,
        border: `1.5px solid ${borderColor}`,
        padding: "2px 14px",
        transition: "border-color 120ms ease",
        ...containerStyle,
      }}
    >
      {leading}
      <input
        {...input}
        aria-invalid={invalid || undefined}
        className="sb-input"
        style={{ ...ui(14.5, { color: C.ink }), ...style }}
      />
      {trailing}
    </div>
  );
}

/** Multi-line variant of {@link AppTextField} (`maxLines > 1`). */
export function AppTextArea({
  borderColor = C.inputBorder,
  invalid = false,
  containerStyle,
  background = C.white,
  style,
  rows = 3,
  ...input
}: FieldBaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div
      className="sb-field"
      data-error={invalid ? "true" : undefined}
      style={{
        background,
        borderRadius: R.input,
        border: `1.5px solid ${borderColor}`,
        padding: "2px 14px",
        transition: "border-color 120ms ease",
        ...containerStyle,
      }}
    >
      <textarea
        {...input}
        rows={rows}
        aria-invalid={invalid || undefined}
        className="sb-input"
        style={{ ...ui(14.5, { color: C.ink, height: 1.45 }), ...style }}
      />
    </div>
  );
}

/** Error line under a field (Flutter `InputDecoration.errorText`). */
export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" style={{ ...ui(12, { color: C.danger, height: 1.35 }), padding: "6px 4px 0" }}>
      {children}
    </div>
  );
}

/** Quantity stepper: − value + */
export function QtyStepper({
  value,
  onMinus,
  onPlus,
  plusColor = C.green,
  suffix,
}: {
  value: number;
  onMinus?: (() => void) | null;
  onPlus?: (() => void) | null;
  plusColor?: string;
  suffix?: string;
}) {
  const circle = (sign: string, filled: boolean, onTap: (() => void) | null | undefined, label: string) => (
    <button
      type="button"
      className="sb-tap"
      aria-label={label}
      disabled={!onTap}
      onClick={onTap ?? undefined}
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        background: filled ? plusColor : "transparent",
        border: filled ? "none" : `1.5px solid ${C.inputBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        ...ui(18, { color: filled ? C.white : C.muted, height: 1 }),
      }}
    >
      {sign}
    </button>
  );
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
      {circle("−", false, onMinus, "Kurangi jumlah")}
      <span style={ui(16, { weight: 700 })} aria-live="polite">
        {suffix ? `${value} ${suffix}` : value}
      </span>
      {circle("+", true, onPlus, "Tambah jumlah")}
    </div>
  );
}

/** Menu row (icon + label + chevron) used by the profile screens. */
export function MenuRow({
  icon,
  label,
  onTap,
  last = false,
}: {
  icon: IconName;
  label: string;
  onTap?: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      className="sb-ink"
      disabled={!onTap}
      onClick={onTap}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "15px 16px",
        borderBottom: last ? undefined : `1px solid ${C.divider}`,
        textAlign: "left",
      }}
    >
      <Icon name={icon} size={20} color={C.body} />
      <span style={{ ...ui(14.5, { color: C.ink }), flex: 1, minWidth: 0 }}>{label}</span>
      <Icon name="chevron_right" size={20} color={C.chevron} />
    </button>
  );
}

/** Small stat card. */
export function StatTile({
  value,
  label,
  background,
  valueColor,
  labelColor,
  border,
  style,
}: {
  value: string;
  label: string;
  background: string;
  valueColor: string;
  labelColor: string;
  border?: string;
  style?: CSSProperties;
}) {
  return (
    <div style={{ padding: "11px 13px", background, borderRadius: 14, border, minWidth: 0, ...style }}>
      <div style={{ ...display(18, { weight: 800, color: valueColor }), ...ellipsis }}>{value}</div>
      <div style={{ ...ui(11.5, { color: labelColor }), marginTop: 2 }}>{label}</div>
    </div>
  );
}

/** Section title (Bricolage) with an optional action on the right. */
export function SectionHeading({
  title,
  leadingIcon,
  actionLabel,
  onAction,
  actionColor = C.greenBright,
  fontSize = 17,
}: {
  title: string;
  leadingIcon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionColor?: string;
  fontSize?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <h2 style={display(fontSize, { weight: 700 })}>{title}</h2>
      {leadingIcon}
      <span style={{ flex: 1 }} />
      {actionLabel ? (
        <button type="button" className="sb-tap" onClick={onAction} style={ui(13, { weight: 700, color: actionColor })}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Underlined tab switch (Aktif / Riwayat). */
export function TabSwitch({
  tabs,
  index,
  onTap,
  activeColor = C.green,
  underlineColor = C.green,
  badges,
}: {
  tabs: string[];
  index: number;
  onTap: (index: number) => void;
  activeColor?: string;
  underlineColor?: string;
  badges?: Partial<Record<number, ReactNode>>;
}) {
  return (
    <div role="tablist" style={{ display: "flex" }}>
      {tabs.map((tab, i) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={i === index}
          className="sb-tap"
          onClick={() => onTap(i)}
          style={{ paddingRight: 24, flex: "none" }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              paddingBottom: 9,
              borderBottom: `2.5px solid ${i === index ? underlineColor : "transparent"}`,
            }}
          >
            <span style={ui(14.5, { weight: i === index ? 700 : 600, color: i === index ? activeColor : C.navInactive })}>{tab}</span>
            {badges?.[i] ?? null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Thin progress bar ("5 dari 8 terjual"). */
export function ProgressBar({
  fraction,
  color = C.greenBright,
  background = C.border,
  height = 7,
}: {
  fraction: number;
  color?: string;
  background?: string;
  height?: number;
}) {
  const width = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      style={{ height, background, borderRadius: height / 2, overflow: "hidden" }}
    >
      <div style={{ width: `${width}%`, height: "100%", background: color }} />
    </div>
  );
}

/** Green info banner (e.g. store impact). */
export function InfoBanner({
  children,
  icon = "eco_outlined",
  background = C.greenSoftBg,
  iconColor = C.greenAccent,
  style,
}: {
  children: ReactNode;
  icon?: IconName;
  background?: string;
  iconColor?: string;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 15px", background, borderRadius: 16, ...style }}>
      <Icon name={icon} size={20} color={iconColor} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** White card with the standard border. */
export function AppCard({
  children,
  padding = 14,
  radius = R.cardSm,
  borderColor = C.border,
  borderWidth = 1,
  onTap,
  style,
  ariaLabel,
}: {
  children: ReactNode;
  padding?: number | string;
  radius?: number;
  borderColor?: string;
  borderWidth?: number;
  onTap?: () => void;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const cardStyle: CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding,
    background: C.white,
    borderRadius: radius,
    border: `${borderWidth}px solid ${borderColor}`,
    ...style,
  };
  if (!onTap) return <div style={cardStyle}>{children}</div>;
  return (
    <button type="button" className="sb-tap" aria-label={ariaLabel} onClick={onTap} style={cardStyle}>
      {children}
    </button>
  );
}

/** Generic empty state: icon circle + title + message + optional actions. */
export function EmptyState({
  icon,
  title,
  message,
  action,
  secondaryAction,
  style,
}: {
  icon: IconName;
  title: string;
  message: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "0 36px", ...style }}>
      <div
        style={{
          width: 104,
          height: 104,
          borderRadius: "50%",
          background: C.emptyCircle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <Icon name={icon} size={48} color={C.emptyIcon} />
      </div>
      <h2 style={{ ...display(22, { weight: 800 }), marginTop: 22 }}>{title}</h2>
      <p style={{ ...ui(14, { color: C.body, height: 1.55 }), marginTop: 8 }}>{message}</p>
      {action ? <div style={{ marginTop: 24, width: "100%", display: "flex", justifyContent: "center" }}>{action}</div> : null}
      {secondaryAction ? (
        <div style={{ marginTop: 12, width: "100%", display: "flex", justifyContent: "center" }}>{secondaryAction}</div>
      ) : null}
    </div>
  );
}

/**
 * Material 3 `Divider`. Its default colour is the scheme's `outlineVariant`
 * (the theme's `dividerColor` is not used by M3 dividers).
 */
export function Divider({ color = "#BFC9C2", height = 1, style }: { color?: string; height?: number; style?: CSSProperties }) {
  return <div role="separator" style={{ height, background: color, flex: "none", ...style }} />;
}

/** `CircularProgressIndicator`. */
export function Spinner({
  size = 36,
  strokeWidth = 4,
  color = C.greenBright,
  label,
}: {
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="sb-spinner"
      style={{ width: size, height: size, borderWidth: strokeWidth, borderColor: color }}
    />
  );
}

/** Centered `CircularProgressIndicator` filling the available space. */
export function CenteredSpinner({ color = C.greenBright, label = "Memuat" }: { color?: string; label?: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 120 }}>
      <Spinner color={color} label={label} />
    </div>
  );
}

/** Indeterminate `LinearProgressIndicator`. */
export function LinearProgress({ color = C.greenBright, background = C.border }: { color?: string; background?: string }) {
  return <div className="sb-linear-progress" role="progressbar" aria-label="Memuat" style={{ color, background }} />;
}

/** Material `Badge` on top of an icon (count or a small dot). */
export function CountBadge({
  count,
  background = C.terracotta,
  color = C.white,
  style,
}: {
  count?: number | string | null;
  background?: string;
  color?: string;
  style?: CSSProperties;
}) {
  const dot = count === undefined || count === null || count === "";
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: dot ? 2 : -4,
        right: dot ? 2 : -6,
        minWidth: dot ? 6 : 16,
        height: dot ? 6 : 16,
        padding: dot ? 0 : "0 4px",
        borderRadius: 8,
        background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...ui(11, { weight: 700, color, height: 1 }),
        ...style,
      }}
    >
      {dot ? null : count}
    </span>
  );
}

/** Material `Switch` (M3 proportions, brand colour). */
export function Switch({
  value,
  onChange,
  activeColor = C.greenBright,
  label,
  disabled = false,
}: {
  value: boolean;
  onChange?: (value: boolean) => void;
  activeColor?: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled || !onChange}
      onClick={() => onChange?.(!value)}
      style={{
        width: 52,
        height: 32,
        borderRadius: 16,
        flex: "none",
        position: "relative",
        background: value ? activeColor : C.neutralChip,
        border: value ? `2px solid ${activeColor}` : `2px solid ${C.chevron}`,
        transition: "background-color 150ms ease, border-color 150ms ease",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "50%",
          left: value ? 22 : 4,
          width: value ? 24 : 16,
          height: value ? 24 : 16,
          marginTop: value ? -12 : -8,
          borderRadius: "50%",
          background: value ? C.white : C.chevron,
          transition: "left 150ms ease, width 150ms ease, height 150ms ease, margin 150ms ease",
        }}
      />
    </button>
  );
}

/** Material `Slider` backed by a native range input. */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  color = C.green,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  color?: string;
  label?: string;
}) {
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step ?? "any"}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      style={{ width: "100%", accentColor: color }}
    />
  );
}

/** `Wrap(spacing, runSpacing)`. */
export function Wrap({
  spacing = 0,
  runSpacing = 0,
  children,
  style,
  justify = "flex-start",
}: {
  spacing?: number;
  runSpacing?: number;
  children: ReactNode;
  style?: CSSProperties;
  justify?: CSSProperties["justifyContent"];
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", columnGap: spacing, rowGap: runSpacing, justifyContent: justify, ...style }}>
      {children}
    </div>
  );
}

/** Error/notice box used across forms (`dangerBg` with danger text). */
export function ErrorBox({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      style={{ padding: 12, background: C.dangerBg, borderRadius: 12, ...ui(12.5, { color: C.danger, height: 1.4 }), ...style }}
    >
      {children}
    </div>
  );
}
