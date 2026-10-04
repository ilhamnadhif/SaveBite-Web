"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import { e2eMode } from "../../lib/env";
import type { IncomingOrder } from "../../lib/models";
import { FilledButton, IconButton, PrimaryButton, TextButton } from "../../ui/buttons";
import { Gap, Screen, Scroll, Spinner, safeBottom, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { DialogSurface, showDialog } from "../../ui/overlays";
import { C, argb, clamp, display, ui } from "../../ui/theme";
import { dartTrim, extractPickupToken } from "./pickupToken";
import { useQrScanner, type QrScanner, type ScannerErrorCode, type ScannerState } from "./useQrScanner";

const INVALID_VOUCHER = "QR ini bukan voucher pickup SaveBite yang valid.";

/**
 * Merchant pickup scanner. The Dart route kept a `code` parameter only for
 * old routes and never redeemed with it: the token must come from a QR the
 * camera actually read (or, in E2E builds, the staging input).
 */
export function ScanQrScreen() {
  const [busy, setBusy] = useState(false);
  const [redeemed, setRedeemed] = useState<IncomingOrder | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const completedRef = useRef(false);
  const lastRejectedValue = useRef<string | null>(null);
  const alive = useRef(true);
  const completed = redeemed !== null;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const scanner = useQrScanner({
    onDetect: (values) => onDetect(values),
    onDetectError: () => {
      if (!alive.current || busyRef.current) return;
      setMessage("QR belum dapat dibaca. Coba arahkan ulang kamera.");
    },
  });

  const setBusyState = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };

  const onDetect = (values: string[]) => {
    if (busyRef.current || completedRef.current) return;
    for (const value of values) {
      const raw = dartTrim(value);
      if (!raw) continue;
      const token = extractPickupToken(raw);
      if (token === null) {
        if (lastRejectedValue.current === raw) return;
        lastRejectedValue.current = raw;
        setMessage(INVALID_VOUCHER);
        return;
      }
      void redeem(token);
      return;
    }
  };

  const showE2eScannedTokenInput = async () => {
    if (!e2eMode() || busyRef.current || completedRef.current) return;
    const raw = await showDialog<string>((close) => <E2eScannedTokenDialog close={close} />, {
      label: "Hasil scan QR staging",
    });
    if (!alive.current || raw === undefined || raw === "") return;
    const token = extractPickupToken(raw);
    if (token === null) {
      setMessage(INVALID_VOUCHER);
      return;
    }
    await redeem(token);
  };

  const redeem = async (token: string) => {
    if (busyRef.current || completedRef.current) return;
    setBusyState(true);
    setMessage(null);
    try {
      try {
        await scanner.stop();
      } catch {
        // The server redeem stays safe when the camera is already stopped/unavailable.
      }
      const order = await appState.redeemOrder(token);
      if (!alive.current) return;
      if (order === null) {
        setBusyState(false);
        setMessage("Voucher tidak ditemukan, sudah dipakai, atau bukan milik toko ini.");
        await restartScanner();
        return;
      }
      completedRef.current = true;
      setBusyState(false);
      setRedeemed(order);
      setMessage(null);
      // The camera never runs again on the success screen.
      await scanner.stop();
    } catch (error) {
      if (!alive.current) return;
      setBusyState(false);
      setMessage(error instanceof BackendException ? error.message : "Voucher belum dapat diverifikasi. Coba lagi.");
      await restartScanner();
    }
  };

  const restartScanner = async ({ clearMessage = false }: { clearMessage?: boolean } = {}) => {
    if (!alive.current || completedRef.current) return;
    if (clearMessage) setMessage(null);
    lastRejectedValue.current = null;
    try {
      await scanner.start();
    } catch {
      // Camera errors surface through the scanner state (errorBuilder).
    }
  };

  const showWebCameraPermissionHelp = () => {
    setMessage(
      "Izinkan kamera dari ikon izin di bilah alamat browser, lalu muat ulang halaman dan buka scanner kembali.",
    );
  };

  const torchState = scanner.state.torchState;
  const torchOn = torchState === "on";

  return (
    <Screen background={C.scanBg}>
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          paddingTop: safeTop(8),
          paddingRight: 14,
          paddingBottom: 8,
          paddingLeft: 14,
        }}
      >
        <IconButton
          tooltip="Tutup scanner"
          icon={<Icon name="close_rounded" color={C.white} />}
          onTap={() => void AppNav.pop(completed)}
        />
        <div style={{ width: 4, flex: "none" }} />
        <h1 style={{ ...display(18, { weight: 700, color: C.white }), flex: 1, minWidth: 0 }}>Scan QR konsumen</h1>
        {torchState === "unavailable" || completed ? (
          <div style={{ width: 48, flex: "none" }} />
        ) : (
          <IconButton
            tooltip={torchOn ? "Matikan senter" : "Nyalakan senter"}
            icon={<Icon name={torchOn ? "flash_on_rounded" : "flash_off_rounded"} color={torchOn ? C.amber : C.white} />}
            onTap={busy ? null : () => void scanner.toggleTorch()}
          />
        )}
      </div>
      <Scroll style={{ padding: "20px 24px 16px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          {completed ? (
            <CompletedIllustration />
          ) : (
            <ScannerFrame
              videoRef={scanner.videoRef}
              state={scanner.state}
              busy={busy}
              onPermissionHelp={showWebCameraPermissionHelp}
              onRetry={() => void restartScanner({ clearMessage: true })}
            />
          )}
          <Gap h={24} />
          <p
            aria-live="polite"
            style={{
              ...ui(14, { weight: completed ? 700 : 500, color: completed ? C.white : C.scanMuted }),
              textAlign: "center",
            }}
          >
            {completed
              ? "Pickup berhasil dikonfirmasi"
              : busy
                ? "Memverifikasi pesanan…"
                : "Arahkan kamera ke QR di layar pembeli."}
          </p>
          {e2eMode() && !completed && !busy ? (
            <>
              <Gap h={10} />
              <div data-testid="e2e-scanned-token-button" style={{ display: "flex" }}>
                <TextButton
                  label="Masukkan hasil scan staging"
                  icon="science_outlined"
                  color={C.amber}
                  onTap={() => void showE2eScannedTokenInput()}
                />
              </div>
            </>
          ) : null}
          {message !== null ? (
            <>
              <Gap h={14} />
              <MessageCard message={message} />
            </>
          ) : null}
        </div>
      </Scroll>
      <div style={{ flex: "none", padding: "14px 24px 0", paddingBottom: safeBottom(24) }}>
        {redeemed !== null ? (
          <>
            <SuccessCard order={redeemed} />
            <Gap h={14} />
            <PrimaryButton merchant label="Selesai" onTap={() => void AppNav.pop(true)} />
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="lock_outline_rounded" size={15} color={C.scanMuted} />
            <div style={{ width: 6, flex: "none" }} />
            <span style={{ ...ui(12, { color: C.scanMuted }), textAlign: "center", minWidth: 0 }}>
              Token pickup divalidasi aman oleh server.
            </span>
          </div>
        )}
      </div>
    </Screen>
  );
}

function ScannerFrame({
  videoRef,
  state,
  busy,
  onPermissionHelp,
  onRetry,
}: {
  videoRef: QrScanner["videoRef"];
  state: ScannerState;
  busy: boolean;
  onPermissionHelp: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Area kamera untuk memindai QR pickup konsumen"
      style={{ position: "relative", width: 280, maxWidth: "100%", height: 280, flex: "none" }}
    >
      <div style={{ position: "absolute", inset: 0, borderRadius: 22, overflow: "hidden" }}>
        <video
          ref={videoRef}
          aria-hidden
          autoPlay
          muted
          playsInline
          disablePictureInPicture
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
            transform: state.mirrored ? "scaleX(-1)" : undefined,
          }}
        />
        {!state.isInitialized ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: C.scanCard,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Spinner color={C.greenBright} label="Memuat" />
          </div>
        ) : state.error !== null ? (
          <CameraError error={state.error} onPermissionHelp={onPermissionHelp} onRetry={onRetry} />
        ) : null}
      </div>
      <div
        aria-hidden
        style={{ position: "absolute", inset: 0, borderRadius: 22, border: `1px solid ${C.scanCardBorder}`, pointerEvents: "none" }}
      />
      <Corner style={{ top: -1, left: -1 }} top left />
      <Corner style={{ top: -1, right: -1 }} top right />
      <Corner style={{ bottom: -1, left: -1 }} bottom left />
      <Corner style={{ bottom: -1, right: -1 }} bottom right />
      {busy ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 22,
            overflow: "hidden",
            background: argb(0x99101b16),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spinner color={C.amber} />
        </div>
      ) : null}
    </div>
  );
}

/** `_cameraError`, web branch (`kIsWeb`). */
function CameraError({
  error,
  onPermissionHelp,
  onRetry,
}: {
  error: ScannerErrorCode;
  onPermissionHelp: () => void;
  onRetry: () => void;
}) {
  const denied = error === "permissionDenied";
  return (
    <div
      role="alert"
      style={{
        position: "absolute",
        inset: 0,
        background: C.scanCard,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={denied ? "no_photography_outlined" : "camera_alt_outlined"} size={42} color={C.scanMuted} />
      <Gap h={12} />
      <p style={{ ...ui(13, { color: C.white, height: 1.4 }), textAlign: "center" }}>
        {denied ? "Izin kamera diperlukan untuk scan QR." : "Kamera belum dapat digunakan."}
      </p>
      <Gap h={12} />
      <TextButton
        label={denied ? "Cara mengizinkan" : "Coba lagi"}
        color={C.amber}
        onTap={denied ? onPermissionHelp : onRetry}
      />
    </div>
  );
}

/** `_corner`: a 48×48 amber L with an 18 radius on the outer corner. */
function Corner({
  style,
  top = false,
  bottom = false,
  left = false,
  right = false,
}: {
  style: CSSProperties;
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}) {
  const side = `4px solid ${C.amber}`;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        width: 48,
        height: 48,
        pointerEvents: "none",
        borderTop: top ? side : undefined,
        borderBottom: bottom ? side : undefined,
        borderLeft: left ? side : undefined,
        borderRight: right ? side : undefined,
        borderTopLeftRadius: top && left ? 18 : 0,
        borderTopRightRadius: top && right ? 18 : 0,
        borderBottomLeftRadius: bottom && left ? 18 : 0,
        borderBottomRightRadius: bottom && right ? 18 : 0,
        ...style,
      }}
    />
  );
}

function CompletedIllustration() {
  return (
    <div
      style={{
        width: 150,
        height: 150,
        flex: "none",
        borderRadius: "50%",
        background: C.greenBright,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name="check_rounded" size={78} color={C.white} />
    </div>
  );
}

function MessageCard({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        alignSelf: "stretch",
        display: "flex",
        alignItems: "flex-start",
        padding: 13,
        background: argb(0x1cc24420),
        borderRadius: 13,
        border: `1px solid ${argb(0x64c24420)}`,
      }}
    >
      <Icon name="error_outline_rounded" size={19} color={C.danger} />
      <div style={{ width: 9, flex: "none" }} />
      <span style={{ ...ui(12.5, { color: C.white, height: 1.4 }), flex: 1, minWidth: 0 }}>{message}</span>
    </div>
  );
}

function SuccessCard({ order }: { order: IncomingOrder }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: 14,
        background: C.scanCard,
        borderRadius: 16,
        border: `1px solid ${C.scanCardBorder}`,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          flex: "none",
          borderRadius: "50%",
          background: C.greenBright,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="check" size={22} color={C.white} />
      </div>
      <div style={{ width: 12, flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={ui(14, { weight: 700, color: C.white })}>Pesanan berhasil di-redeem</div>
        <div style={{ ...ui(12, { color: C.scanMuted }), ...clamp(2), marginTop: 2 }}>
          {`${order.customer} · ${order.bags} bag${order.bagTitle ? ` · ${order.bagTitle}` : ""}`}
        </div>
      </div>
    </div>
  );
}

/** E2E-only stand-in for a decoded QR value (staging builds only). */
function E2eScannedTokenDialog({ close }: { close: (value?: string) => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement | null>(null);

  // `autofocus: true`. The overlay host focuses its panel after mounting, so
  // the field takes focus right after that.
  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <DialogSurface
      title={<span style={ui(24, { weight: 400, color: C.ink, height: 1.33 })}>Hasil scan QR staging</span>}
      actions={
        <>
          <TextButton label="Batal" onTap={() => close()} />
          <span data-testid="e2e-scanned-token-submit" style={{ display: "flex" }}>
            <FilledButton label="Verifikasi" onTap={() => close(dartTrim(text))} />
          </span>
        </>
      }
    >
      <label htmlFor="e2e-scanned-token" style={{ display: "block", ...ui(12, { weight: 400, color: C.green }) }}>
        Token hasil decode QR
      </label>
      <div className="sb-field" style={{ borderBottom: `1px solid ${C.body}`, transition: "border-color 120ms ease" }}>
        <input
          ref={input}
          id="e2e-scanned-token"
          data-testid="e2e-scanned-token-field"
          className="sb-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          style={{ ...ui(16, { weight: 400, color: C.ink, letterSpacing: 0.5 }), padding: "8px 0" }}
        />
      </div>
    </DialogSurface>
  );
}
