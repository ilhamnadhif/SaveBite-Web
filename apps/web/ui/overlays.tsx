"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { navigator } from "../lib/navigator";
import { TextButton } from "./buttons";
import { Icon, type IconName } from "./Icon";
import { C, SHEET_BARRIER, display, ui } from "./theme";

/**
 * Modal overlays: `showModalBottomSheet`, `showDialog`, `AppDialog.confirm`,
 * and `AppFeedback.snack`, rendered inside the app column by <OverlayHost/>.
 */

type Close<T> = (value?: T) => void;

type OverlayItem = {
  id: string;
  kind: "sheet" | "dialog";
  render: (close: Close<unknown>) => ReactNode;
  resolve: (value: unknown) => void;
  barrierColor: string;
  dismissible: boolean;
  closing: boolean;
  label?: string;
};

type SnackItem = { id: string; message: string; icon?: IconName };

let counter = 0;
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

class OverlayStore {
  overlays: OverlayItem[] = [];
  snack: SnackItem | null = null;
  /** True while a shell with a bottom navigation bar is the visible route. */
  aboveNav = false;
  private listeners = new Set<() => void>();
  private version = 0;
  private snackTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  emit() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  open<T>(
    kind: OverlayItem["kind"],
    render: (close: Close<T>) => ReactNode,
    options: { barrierColor?: string; dismissible?: boolean; label?: string } = {},
  ): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      const id = nextId(kind);
      const item: OverlayItem = {
        id,
        kind,
        render: render as (close: Close<unknown>) => ReactNode,
        resolve: resolve as (value: unknown) => void,
        barrierColor: options.barrierColor ?? (kind === "sheet" ? SHEET_BARRIER : "rgba(0, 0, 0, 0.54)"),
        dismissible: options.dismissible ?? true,
        closing: false,
        label: options.label,
      };
      this.overlays = [...this.overlays, item];
      this.emit();
      // The browser back button closes the overlay through the navigator.
      void navigator.openOverlay(id, () => this.finish(id, undefined, false));
    });
  }

  /** App-initiated close: animate out, release the history entry, resolve. */
  close(id: string, value: unknown) {
    this.finish(id, value, true);
  }

  private finish(id: string, value: unknown, fromApp: boolean) {
    const item = this.overlays.find((overlay) => overlay.id === id);
    if (!item || item.closing) return;
    item.closing = true;
    this.emit();
    if (fromApp) void navigator.closeOverlay(id);
    setTimeout(() => {
      this.overlays = this.overlays.filter((overlay) => overlay.id !== id);
      this.emit();
      item.resolve(value);
    }, 170);
  }

  showSnack(message: string, icon?: IconName) {
    if (this.snackTimer) clearTimeout(this.snackTimer);
    this.snack = { id: nextId("s"), message, icon };
    this.emit();
    this.snackTimer = setTimeout(() => {
      this.snack = null;
      this.emit();
    }, 4000);
  }

  hideSnack() {
    if (this.snackTimer) clearTimeout(this.snackTimer);
    this.snack = null;
    this.emit();
  }
}

const store = new OverlayStore();

/**
 * `showModalBottomSheet(isScrollControlled: true, backgroundColor:
 * transparent)`. The sheet widget draws its own surface (see
 * {@link SheetSurface}); call `close(value)` to pop with a result.
 */
export function showSheet<T>(
  render: (close: Close<T>) => ReactNode,
  options?: { barrierColor?: string; dismissible?: boolean; label?: string },
): Promise<T | undefined> {
  return store.open<T>("sheet", render, options);
}

/** `showDialog`. The content draws its own surface (see {@link DialogSurface}). */
export function showDialog<T>(
  render: (close: Close<T>) => ReactNode,
  options?: { barrierColor?: string; dismissible?: boolean; label?: string },
): Promise<T | undefined> {
  return store.open<T>("dialog", render, options);
}

/** Shells call this so snack bars float above their bottom navigation. */
export function setSnackAboveNav(value: boolean) {
  if (store.aboveNav === value) return;
  store.aboveNav = value;
  store.emit();
}

/** `AppFeedback.snack(context, message, icon: …)`. */
export function snack(message: string, icon?: IconName) {
  store.showSnack(message, icon);
}

/** `AppDialog.confirm`. Resolves `true` only when confirmed. */
export async function confirmDialog({
  title,
  message,
  confirmLabel = "Ya",
  cancelLabel = "Batal",
  destructive = false,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const result = await showDialog<boolean>(
    (close) => (
      <DialogSurface
        title={title}
        actions={
          <>
            <TextButton label={cancelLabel} onTap={() => close(false)} color={C.body} fontWeight={700} />
            <TextButton
              label={confirmLabel}
              onTap={() => close(true)}
              color={destructive ? C.danger : C.greenAccent}
              fontWeight={800}
            />
          </>
        }
      >
        <p style={ui(14, { color: C.body, height: 1.5 })}>{message}</p>
      </DialogSurface>
    ),
    { label: title },
  );
  return result ?? false;
}

/** The cream, r20 surface of the app's `AlertDialog` theme. */
export function DialogSurface({
  title,
  children,
  actions,
  style,
}: {
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ background: C.cream, borderRadius: 20, padding: "24px 24px 12px", boxShadow: "0 12px 40px rgba(0,0,0,0.22)", ...style }}>
      {title ? <h2 style={{ ...display(19, { weight: 800 }), marginBottom: 16 }}>{title}</h2> : null}
      {children}
      {actions ? (
        <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 4, marginTop: 18, marginRight: -12 }}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The standard SaveBite sheet surface: rounded 28 top corners, handle, and
 * keyboard-safe bottom padding. Content scrolls when it is taller than the
 * screen (`isScrollControlled`).
 */
export function SheetSurface({
  children,
  background = C.cream,
  padding = "12px 20px 24px",
  handle = true,
  style,
}: {
  children: ReactNode;
  background?: string;
  padding?: string;
  handle?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className="sb-scroll"
      style={{
        background,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        padding,
        paddingBottom: `calc(24px + var(--safe-bottom))`,
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 -8px 30px rgba(0,0,0,0.12)",
        ...style,
      }}
    >
      {handle ? (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div aria-hidden style={{ width: 42, height: 5, marginBottom: 20, background: C.handle, borderRadius: 3 }} />
        </div>
      ) : null}
      {children}
    </div>
  );
}

function OverlayView({ item }: { item: OverlayItem }) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [previousFocus] = useState(() => (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null));
  const close: Close<unknown> = (value) => store.close(item.id, value);

  useEffect(() => {
    const element = panel.current;
    // A control inside the overlay already took focus (`autoFocus`): keep it.
    if (element && element.contains(document.activeElement)) {
      return () => previousFocus?.focus?.({ preventScroll: true });
    }
    const focusable = element?.querySelector<HTMLElement>(
      "input, textarea, select, button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
    );
    // Do not pop the soft keyboard for sheets that start with a text field;
    // focus the panel itself so screen readers land inside the dialog.
    if (focusable && focusable.tagName === "BUTTON") focusable.focus({ preventScroll: true });
    else element?.focus({ preventScroll: true });
    return () => previousFocus?.focus?.({ preventScroll: true });
  }, [previousFocus]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && item.dismissible) {
        const topmost = store.overlays[store.overlays.length - 1];
        if (topmost?.id === item.id) close(undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.dismissible]);

  return (
    <div className="sb-overlay" data-kind={item.kind} data-closing={item.closing ? "true" : undefined}>
      <div
        className="sb-overlay-barrier"
        style={{ background: item.barrierColor }}
        onClick={item.dismissible ? () => close(undefined) : undefined}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={item.label}
        tabIndex={-1}
        className={item.kind === "sheet" ? "sb-sheet" : "sb-dialog"}
        style={{ outline: "none" }}
      >
        {item.render(close)}
      </div>
    </div>
  );
}

/** Renders overlays and the snack bar. Mount once inside the app column. */
export function OverlayHost() {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const snackItem = store.snack;
  const aboveNav = store.aboveNav;
  return (
    <>
      {store.overlays.map((item) => (
        <OverlayView key={item.id} item={item} />
      ))}
      <div className="sb-snack-host" data-above-nav={aboveNav ? "true" : undefined} aria-live="polite">
        {snackItem ? (
          <div
            key={snackItem.id}
            className="sb-snack"
            role="status"
            onClick={() => store.hideSnack()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 16px",
              background: C.green,
              borderRadius: 14,
              boxShadow: "0 4px 14px rgba(0,0,0,0.22)",
            }}
          >
            {snackItem.icon ? <Icon name={snackItem.icon} size={18} color={C.amber} /> : null}
            <span style={{ ...ui(13.5, { weight: 600, color: C.cream, height: 1.35 }), flex: 1, minWidth: 0 }}>{snackItem.message}</span>
          </div>
        ) : null}
      </div>
    </>
  );
}
