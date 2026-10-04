"use client";

import { useEffect, useReducer, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import { midtransSandbox } from "../../lib/env";
import { isAwaitingCustomer, isPaid, isTerminalFailure, type Bag, type OrderRecord } from "../../lib/models";
import { usePopGuard } from "../../ui/NavigatorView";
import { GhostButton, OutlinedButton, PrimaryButton } from "../../ui/buttons";
import { Divider, Gap, Screen, Scroll, Spinner, safeBottom, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, display, ui } from "../../ui/theme";
import { SnapCheckoutView } from "./SnapCheckoutView";
import { SnapCheckoutSession, canonicalHttpsUrl, parsePaymentUri } from "./snapCheckoutSession";

type ProcessingProps = {
  bag: Bag;
  qty: number;
  method: string;
  idempotencyKey: string | null;
  existingOrder: OrderRecord | null;
};

const ALLOWED_QR_HOSTS: ReadonlySet<string> = new Set(["api.sandbox.midtrans.com", "api.midtrans.com"]);
const QR_RESOURCE_ID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const POLL_INTERVAL_MS = 4000;
/** Material 3 `Divider` colour: `outlineVariant` of the app's seeded colour scheme. */
const M3_OUTLINE_VARIANT = "#BFC9C2";

/** `_paymentQrUri`: only the official Midtrans QR image endpoints. */
function paymentQrUri(order: OrderRecord | null): string | null {
  const rawUrl = order?.paymentQrUrl?.trim();
  if (!rawUrl) return null;
  const uri = parsePaymentUri(rawUrl);
  if (
    uri === null ||
    uri.scheme !== "https" ||
    !ALLOWED_QR_HOSTS.has(uri.host) ||
    uri.port !== 443 ||
    uri.userInfo !== "" ||
    uri.hasQuery ||
    uri.hasFragment
  ) {
    return null;
  }
  const segments = uri.pathSegments;
  if (
    segments.length !== 4 ||
    segments[0] !== "v2" ||
    (segments[1] !== "qris" && segments[1] !== "gopay") ||
    !QR_RESOURCE_ID.test(segments[2]) ||
    segments[3] !== "qr-code"
  ) {
    return null;
  }
  return canonicalHttpsUrl(uri);
}

/** `_simulatorQrUri`: sandbox only, for the Midtrans QRIS Simulator. */
function simulatorQrUri(order: OrderRecord | null): string | null {
  if (!midtransSandbox()) return null;
  const rawUrl = order?.simulatorQrImageUrl?.trim();
  if (!rawUrl) return null;
  const uri = parsePaymentUri(rawUrl);
  if (
    uri === null ||
    uri.scheme !== "https" ||
    uri.host !== "api.sandbox.midtrans.com" ||
    uri.port !== 443 ||
    uri.userInfo !== "" ||
    uri.hasQuery ||
    uri.hasFragment
  ) {
    return null;
  }
  const segments = uri.pathSegments;
  if (
    segments.length !== 4 ||
    segments[0] !== "v2" ||
    segments[1] !== "qris" ||
    !QR_RESOURCE_ID.test(segments[2]) ||
    segments[3] !== "qr-code"
  ) {
    return null;
  }
  return canonicalHttpsUrl(uri);
}

function terminalMessage(order: OrderRecord): string {
  switch (order.paymentState) {
    case "expired":
      return "Waktu pembayaran berakhir. Stok yang ditahan sudah dikembalikan.";
    case "cancelled":
      return "Pembayaran dibatalkan.";
    case "refunded":
      return "Refund telah dikonfirmasi Midtrans untuk diproses. Waktu dana masuk mengikuti metode pembayaran.";
    case "disputed":
      return "Pembayaran sedang ditinjau. Hubungi bantuan jika memerlukan informasi.";
    default:
      return "Pembayaran ditolak atau tidak berhasil.";
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `_ProcessingScreenState`. Creates one idempotent reservation, opens Snap
 * inside the app, and only continues once the backend has verified the
 * status with Midtrans. Timers, lifecycle events and async continuations
 * read these fields synchronously, exactly like the Dart State, so they live
 * on one object and `setState` re-renders the screen.
 */
class ProcessingState {
  order: OrderRecord | null = null;
  creating = false;
  checking = false;
  navigated = false;
  snapReloadEpoch = 0;
  legacyQrReloadEpoch = 0;
  error: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private mounted = false;

  constructor(
    private readonly widget: ProcessingProps,
    private readonly rebuild: () => void,
  ) {}

  get busy(): boolean {
    return this.creating || this.checking;
  }

  private setState(update: () => void) {
    update();
    if (this.mounted) this.rebuild();
  }

  /** `initState` (+ the lifecycle observer); returns `dispose`. */
  mount = () => {
    this.mounted = true;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    // React StrictMode (dev) mounts twice. `createPayment` runs once (its
    // guards survive the remount); polling the simulated unmount stopped for
    // an order already awaiting payment is resumed here.
    const order = this.order;
    if (order !== null && !this.navigated && isAwaitingCustomer(order.paymentState)) this.startPolling();
    void this.createPayment();
    return () => {
      this.mounted = false;
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.cancelPollTimer();
    };
  };

  /** `didChangeAppLifecycleState`: visible = resumed. */
  private onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      if (this.order !== null) {
        this.startPolling();
        void this.checkStatus();
      }
      return;
    }
    // Pause network work while the page is in the background.
    this.cancelPollTimer();
  };

  /** `PopScope(canPop: false)`: back always lands on the orders tab. */
  handlePop = (): boolean => {
    if (this.creating || !this.mounted) return true;
    this.cancelPollTimer();
    // The web navigator replaces the stack asynchronously; a status check
    // still in flight must not navigate on top of the orders tab.
    this.navigated = true;
    AppNav.toOrders();
    return true;
  };

  private async createPayment() {
    if (this.creating || this.order !== null || !this.mounted) return;
    this.setState(() => {
      this.creating = true;
      this.error = null;
    });
    try {
      const existing = this.widget.existingOrder;
      if (existing !== null) {
        this.order = existing;
        this.handleStatus(existing);
        return;
      }
      // The demo backend still completes a deterministic flow. The remote
      // backend always goes through the Edge Function.
      if (!appState.usesRemoteBackend) {
        await delay(650);
      }
      const order = await appState.placeOrder(this.widget.bag, this.widget.qty, this.widget.method, {
        // When null, AppState reuses or creates the persisted key, so a retry
        // after a reload still reaches the same order.
        idempotencyKey: this.widget.idempotencyKey,
      });
      if (!this.mounted) return;
      this.order = order;
      this.handleStatus(order);
    } catch (error) {
      if (await this.recoverAfterCreateFailure()) return;
      if (this.mounted) {
        this.showFailure(
          error instanceof BackendException
            ? error.message
            : "Pembayaran belum dapat dibuat. Periksa koneksi lalu coba lagi.",
          { retrySameRequest: true },
        );
      }
    } finally {
      if (this.mounted) {
        this.setState(() => {
          this.creating = false;
        });
      }
    }
  }

  private async recoverAfterCreateFailure(): Promise<boolean> {
    if (!appState.usesRemoteBackend || !this.mounted) return false;
    try {
      const recovered = await appState.recoverCheckout(this.widget.bag, this.widget.qty, this.widget.method);
      if (recovered === null || !this.mounted) return false;
      this.order = recovered;
      this.handleStatus(recovered);
      return true;
    } catch {
      return false;
    }
  }

  private handleStatus(order: OrderRecord) {
    if (!this.mounted || this.navigated) return;
    this.setState(() => {
      this.order = order;
      this.error = null;
    });
    if (isPaid(order.paymentState)) {
      this.navigated = true;
      this.cancelPollTimer();
      AppNav.toVoucher(order, { completeCheckout: true });
      return;
    }
    if (isTerminalFailure(order.paymentState)) {
      this.showFailure(terminalMessage(order), { retrySameRequest: false });
      return;
    }
    this.startPolling();
  }

  private startPolling() {
    if (!appState.usesRemoteBackend || this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      if (this.mounted) void this.checkStatus();
    }, POLL_INTERVAL_MS);
  }

  private cancelPollTimer() {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  copySimulatorQrUrl = async () => {
    if (this.busy || this.navigated || !this.mounted) return;

    let uri = simulatorQrUri(this.order);
    if (uri === null) {
      // The transaction UUID usually appears only after the customer picks
      // QRIS in Snap. Fetch the latest authoritative status before giving up.
      await this.checkStatus();
      if (!this.mounted || this.navigated) return;
      uri = simulatorQrUri(this.order);
    }
    if (uri === null) {
      if (this.error === null) {
        this.setState(() => {
          this.error =
            "URL gambar QRIS belum tersedia. Pilih QRIS pada panel Midtrans, tunggu beberapa detik, lalu tekan tombol ini lagi.";
        });
      }
      return;
    }
    try {
      await window.navigator.clipboard.writeText(uri);
      if (!this.mounted) return;
      snack("URL QRIS simulator disalin.", "check_circle_outline_rounded");
    } catch {
      if (!this.mounted) return;
      this.setState(() => {
        this.error = "URL QRIS simulator tidak dapat disalin.";
      });
    }
  };

  reloadLegacyQris = () => {
    if (this.busy || this.navigated || !this.mounted) return;
    // Flutter evicts the cached image first. Here the image is remounted
    // under a new key, which requests the same URL again.
    this.setState(() => {
      this.legacyQrReloadEpoch++;
      this.error = null;
    });
  };

  retryPaymentCreation = async () => {
    if (this.busy || this.navigated || !this.mounted) return;
    this.setState(() => {
      this.creating = true;
      this.error = null;
    });
    try {
      const refreshed = await appState.placeOrder(this.widget.bag, this.widget.qty, this.widget.method, {
        // Without an explicit key AppState keeps one per checkout signature,
        // so this retry still reaches the same reservation/provider order.
        idempotencyKey: this.widget.idempotencyKey,
      });
      if (!this.mounted) return;
      this.order = refreshed;
      this.handleStatus(refreshed);
    } catch (error) {
      if (this.mounted) {
        this.setState(() => {
          this.error =
            error instanceof BackendException ? error.message : "Pembayaran belum dapat dibuat. Periksa koneksi lalu coba lagi.";
        });
      }
    } finally {
      if (this.mounted) {
        this.setState(() => {
          this.creating = false;
        });
      }
    }
  };

  reloadSnapCheckout = () => {
    if (this.busy || this.navigated || !this.mounted) return;
    this.setState(() => {
      this.snapReloadEpoch++;
      this.error = null;
    });
  };

  handleSnapStatusHint = () => {
    if (!this.mounted || this.navigated) return;
    // The browser callback is only a hint. No callback field is trusted and
    // the voucher still waits for the server sync.
    void this.checkStatus();
  };

  handleSnapError = (message: string) => {
    if (!this.mounted || this.navigated) return;
    this.setState(() => {
      this.error = message;
    });
  };

  checkStatus = async () => {
    const order = this.order;
    if (this.checking || order === null || this.navigated || !this.mounted) return;
    this.setState(() => {
      this.checking = true;
      this.error = null;
    });
    try {
      const refreshed = await appState.refreshPayment(order);
      if (!this.mounted) return;
      this.handleStatus(refreshed);
    } catch (error) {
      if (this.mounted) {
        this.setState(() => {
          this.error = error instanceof BackendException ? error.message : "Status pembayaran belum dapat diperiksa. Coba lagi.";
        });
      }
    } finally {
      if (this.mounted) {
        this.setState(() => {
          this.checking = false;
        });
      }
    }
  };

  private showFailure(message: string, { retrySameRequest }: { retrySameRequest: boolean }) {
    if (this.navigated) return;
    this.navigated = true;
    this.cancelPollTimer();
    AppNav.toPaymentFailed({
      bag: this.widget.bag,
      method: this.widget.method,
      qty: this.widget.qty,
      // An explicit older key is passed on. When null, AppState already
      // stores the effective key per checkout signature.
      idempotencyKey: retrySameRequest ? this.widget.idempotencyKey : null,
      message,
    });
  }

  get expiryLabel(): string {
    const expiresAt = this.order?.paymentExpiresAt ?? null;
    if (expiresAt === null) {
      return "Selesaikan pembayaran sebelum sesi QRIS kedaluwarsa.";
    }
    const remaining = expiresAt.getTime() - Date.now();
    if (remaining <= 0) return "Waktu pembayaran telah berakhir.";
    const minutes = Math.floor(remaining / 60_000);
    return `Selesaikan dalam sekitar ${minutes} menit.`;
  }
}

/**
 * Creates one idempotent reservation, opens Snap inside the app, and only
 * continues after the backend has verified the status with Midtrans.
 */
export function ProcessingScreen({ bag, qty, method, idempotencyKey, existingOrder }: ProcessingProps) {
  const [, rebuild] = useReducer((version: number) => version + 1, 0);
  const [state] = useState(() => new ProcessingState({ bag, qty, method, idempotencyKey, existingOrder }, rebuild));
  useEffect(() => state.mount(), [state]);
  usePopGuard(state.handlePop);

  const order = state.order;
  const waitingForPayment = order !== null && isAwaitingCustomer(order.paymentState);
  const snapSession = SnapCheckoutSession.tryParse(order?.paymentRedirectUrl, {
    snapToken: order?.paymentSnapToken,
  });
  const qrUri = paymentQrUri(order);
  const simulatorUri = simulatorQrUri(order);

  return (
    <Screen background={C.green}>
      <Scroll style={{ paddingTop: safeTop(28), paddingRight: 28, paddingBottom: safeBottom(32), paddingLeft: 28 }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <StatusIcon waitingForPayment={waitingForPayment} />
        </div>
        <Gap h={24} />
        <h1 style={{ ...display(23, { color: C.cream }), textAlign: "center" }}>
          {waitingForPayment ? "Selesaikan pembayaran" : "Menyiapkan pembayaran…"}
        </h1>
        <Gap h={9} />
        <p style={{ ...ui(14, { color: C.greenMuted, height: 1.5 }), textAlign: "center" }}>
          {waitingForPayment ? state.expiryLabel : "Pesanan dan total sedang diverifikasi secara aman."}
        </p>
        <div aria-live="polite">
          {state.error !== null ? (
            <>
              <Gap h={18} />
              <div
                style={{
                  width: "100%",
                  padding: 13,
                  background: C.dangerBg,
                  borderRadius: 13,
                  textAlign: "center",
                  ...ui(12.5, { color: C.danger }),
                }}
              >
                {state.error}
              </div>
            </>
          ) : null}
        </div>
        {waitingForPayment && order !== null ? (
          <>
            <Gap h={22} />
            {snapSession !== null ? (
              <SnapCard
                session={snapSession}
                reloadEpoch={state.snapReloadEpoch}
                onStatusHint={state.handleSnapStatusHint}
                onError={state.handleSnapError}
              />
            ) : (
              <QrisCard qrUri={qrUri} reloadEpoch={state.legacyQrReloadEpoch} />
            )}
            {snapSession !== null && midtransSandbox() ? (
              <>
                <Gap h={14} />
                <SimulatorQrCard
                  uri={simulatorUri}
                  onCopy={state.busy ? null : () => void state.copySimulatorQrUrl()}
                />
              </>
            ) : null}
            <Gap h={18} />
            <PrimaryButton
              label={
                snapSession !== null
                  ? "Muat ulang halaman pembayaran"
                  : qrUri === null
                    ? state.creating
                      ? "Membuat pembayaran…"
                      : "Coba buat pembayaran lagi"
                    : "Muat ulang QRIS"
              }
              // An unstyled Icon in Dart: it inherits the theme's
              // `iconTheme` colour (AppColors.body), not the button foreground.
              icon={<Icon name="refresh_rounded" size={19} color={C.body} />}
              background={C.amber}
              foreground={C.green}
              onTap={
                state.busy
                  ? null
                  : snapSession !== null
                    ? state.reloadSnapCheckout
                    : qrUri === null
                      ? () => void state.retryPaymentCreation()
                      : state.reloadLegacyQris
              }
            />
            <Gap h={8} />
            <GhostButton
              label={state.checking ? "Memeriksa…" : "Cek status pembayaran"}
              color={C.greenMuted}
              onTap={state.busy ? null : () => void state.checkStatus()}
            />
          </>
        ) : (
          <>
            <Gap h={42} />
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Spinner size={30} strokeWidth={3} color={C.amber} />
            </div>
          </>
        )}
      </Scroll>
    </Screen>
  );
}

function SnapCard({
  session,
  reloadEpoch,
  onStatusHint,
  onError,
}: {
  session: SnapCheckoutSession;
  reloadEpoch: number;
  onStatusHint: () => void;
  onError: (message: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Checkout QRIS Midtrans di dalam aplikasi"
      style={{
        width: "100%",
        background: C.white,
        borderRadius: 20,
        border: `2px solid ${C.amber}`,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <h2 style={ui(15, { weight: 800, color: C.green })}>Pembayaran QRIS</h2>
      </div>
      <Divider color={M3_OUTLINE_VARIANT} />
      <div style={{ height: 560 }}>
        <SnapCheckoutView
          key={`snap-${session.environment}-${session.token}-${reloadEpoch}`}
          session={session}
          onStatusHint={onStatusHint}
          onError={onError}
        />
      </div>
    </div>
  );
}

function SimulatorQrCard({ uri, onCopy }: { uri: string | null; onCopy: (() => void) | null }) {
  return (
    <div
      style={{
        width: "100%",
        padding: 16,
        background: C.cream,
        borderRadius: 16,
        border: `1px solid ${C.amber}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <Icon name="science_outlined" size={21} color={C.green} />
        <Gap w={8} />
        <span style={{ flex: 1, minWidth: 0, ...ui(13.5, { weight: 800, color: C.green }) }}>Alat uji QRIS Sandbox</span>
      </div>
      <Gap h={7} />
      <p style={ui(12, { color: C.body, height: 1.4 })}>
        {uri === null
          ? "Pilih QRIS di atas, lalu ambil URL gambar untuk QRIS Simulator Midtrans."
          : "URL gambar siap ditempel ke QRIS Simulator Midtrans."}
      </p>
      {uri !== null ? (
        <>
          <Gap h={9} />
          <p
            style={{
              ...ui(10.5, { color: C.greenBright, height: 1.35 }),
              overflowWrap: "anywhere",
              userSelect: "text",
              WebkitUserSelect: "text",
            }}
          >
            {uri}
          </p>
        </>
      ) : null}
      <Gap h={10} />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <OutlinedButton
          label={uri === null ? "Ambil & salin URL QRIS" : "Salin URL"}
          icon={uri === null ? "link_rounded" : "copy_rounded"}
          iconSize={17}
          onTap={onCopy}
        />
      </div>
    </div>
  );
}

function QrisCard({ qrUri, reloadEpoch }: { qrUri: string | null; reloadEpoch: number }) {
  return (
    <div
      role="group"
      aria-label="Kode QRIS pembayaran"
      style={{
        width: "100%",
        padding: 18,
        background: C.white,
        borderRadius: 20,
        border: `2px solid ${C.amber}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {qrUri === null ? (
        <>
          <Icon name="qr_code_2_rounded" size={64} color={C.muted} />
          <Gap h={10} />
          <p style={{ ...ui(13, { color: C.body, height: 1.45 }), textAlign: "center" }}>
            Halaman pembayaran belum tersedia. Coba buat pembayaran lagi.
          </p>
        </>
      ) : (
        <>
          <h2 style={ui(15, { weight: 800, color: C.green })}>Pindai kode QRIS</h2>
          <Gap h={14} />
          <div style={{ width: 220, height: 220, flex: "none" }}>
            <QrisNetworkImage key={`qris-network-image-${reloadEpoch}`} src={qrUri} />
          </div>
        </>
      )}
    </div>
  );
}

/** `Image.network` with its loading and error builders. */
function QrisNetworkImage({ src }: { src: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  if (status === "error") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 18,
          background: C.cream,
          borderRadius: 14,
        }}
      >
        <p style={{ ...ui(12.5, { color: C.body, height: 1.45 }), textAlign: "center" }}>
          Gambar QRIS belum dapat dimuat. Muat ulang QRIS untuk mencoba lagi.
        </p>
      </div>
    );
  }
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <img
        src={src}
        alt=""
        decoding="async"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          visibility: status === "loaded" ? "visible" : "hidden",
        }}
      />
      {status === "loading" ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Spinner color={C.green} strokeWidth={3} label="Memuat" />
        </div>
      ) : null}
    </div>
  );
}

function StatusIcon({ waitingForPayment }: { waitingForPayment: boolean }) {
  return (
    <div
      style={{
        width: 88,
        height: 88,
        borderRadius: "50%",
        background: C.greenDark,
        border: `4px solid ${C.amber}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <Icon name={waitingForPayment ? "qr_code_2_rounded" : "lock_clock_outlined"} size={38} color={C.amber} />
    </div>
  );
}
