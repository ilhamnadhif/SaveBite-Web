"use client";

import { useEffect, useReducer, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import type { OrderRecord } from "../../lib/models";
import { FoodImage } from "../../ui/bagCards";
import { GhostButton, TextButton } from "../../ui/buttons";
import { Gap, Screen, Scroll, Spinner, safeBottom, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { QrBox } from "../../ui/qrBox";
import { C, display, ellipsis, ui } from "../../ui/theme";

const CLOCK_INTERVAL_MS = 1000;
const TOKEN_LIFETIME_MS = 60_000;

const pad2 = (value: number) => value.toString().padStart(2, "0");

/**
 * `_VoucherScreenState`. The clock, the appState listener and the token
 * rotation read these fields synchronously, exactly like the Dart State, so
 * they live on one object and `setState` re-renders the screen.
 */
class VoucherState {
  order: OrderRecord;
  tokenRefreshAt: Date | null = null;
  loadingToken = false;
  tokenError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameCallbacks = new Set<ReturnType<typeof setTimeout>>();
  private mounted = false;

  constructor(
    order: OrderRecord,
    private readonly rebuild: () => void,
  ) {
    this.order = order;
  }

  get expiresAt(): Date | null {
    return this.order.expiresAt ?? this.order.bag.pickupEndsAt;
  }

  get pastExpiry(): boolean {
    const expiresAt = this.expiresAt;
    return expiresAt !== null && !(expiresAt.getTime() > Date.now());
  }

  get redeemed(): boolean {
    return this.order.status === "done";
  }

  get cancelled(): boolean {
    return this.order.status === "cancelled";
  }

  get expired(): boolean {
    return this.order.status === "expired" || this.pastExpiry;
  }

  get canShowQr(): boolean {
    return this.order.status === "ready" && !this.redeemed && !this.cancelled && !this.expired;
  }

  private setState(update: () => void) {
    update();
    if (this.mounted) this.rebuild();
  }

  /** `initState`; returns `dispose`. */
  mount = () => {
    this.mounted = true;
    appState.addListener(this.syncOrderFromState);
    this.startClock();
    if (this.canShowQr) this.afterFrame(() => void this.rotateToken());
    return () => {
      this.mounted = false;
      appState.removeListener(this.syncOrderFromState);
      this.cancelTimer();
      // A disposed State never runs its post-frame work. This also keeps the
      // StrictMode (dev) remount from requesting a second token on open.
      for (const callback of this.frameCallbacks) clearTimeout(callback);
      this.frameCallbacks.clear();
    };
  };

  /** `addPostFrameCallback`: run after the pending rebuild. */
  private afterFrame(callback: () => void) {
    const id = setTimeout(() => {
      this.frameCallbacks.delete(id);
      callback();
    }, 0);
    this.frameCallbacks.add(id);
  }

  private startClock() {
    if (this.expiresAt === null) return;
    this.timer = setInterval(this.tick, CLOCK_INTERVAL_MS);
  }

  private cancelTimer() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private tick = () => {
    if (!this.mounted) return;
    // setState(() {}): the countdown labels are recomputed on rebuild.
    this.rebuild();
    const refreshAt = this.tokenRefreshAt;
    if (
      this.canShowQr &&
      this.order.pickupToken !== null &&
      refreshAt !== null &&
      !(refreshAt.getTime() > Date.now())
    ) {
      void this.rotateToken();
    }
    if (this.pastExpiry) this.cancelTimer();
  };

  private syncOrderFromState = () => {
    const latest = [...appState.activeOrders, ...appState.orderHistory].find((order) => order.id === this.order.id) ?? null;
    if (!this.mounted || latest === null) return;

    const becameReady = !this.canShowQr && latest.status === "ready";
    const terminal = latest.status === "done" || latest.status === "cancelled" || latest.status === "expired";
    const synced =
      latest.status === "ready" && latest.pickupToken === null && this.order.pickupToken !== null
        ? { ...latest, pickupToken: this.order.pickupToken }
        : latest;

    this.setState(() => {
      this.order = terminal ? { ...synced, pickupToken: null } : synced;
      if (terminal) {
        this.tokenError = null;
        this.tokenRefreshAt = null;
      }
    });
    if (terminal) {
      this.cancelTimer();
    } else if (this.timer === null) {
      this.startClock();
    }
    if (becameReady) this.afterFrame(() => void this.rotateToken());
  };

  rotateToken = async () => {
    if (!this.mounted || this.loadingToken || !this.canShowQr) return;
    this.setState(() => {
      this.loadingToken = true;
      this.tokenError = null;
    });
    try {
      const refreshed = await appState.issuePickupToken(this.order);
      if (!this.mounted) return;
      this.setState(() => {
        this.order = refreshed;
        this.tokenRefreshAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
      });
    } catch (error) {
      if (!this.mounted) return;
      this.setState(() => {
        this.tokenError =
          error instanceof BackendException ? error.message : "QR pickup gagal dimuat. Periksa koneksi lalu coba lagi.";
      });
    } finally {
      if (this.mounted) {
        this.setState(() => {
          this.loadingToken = false;
        });
      }
    }
  };

  get remainingLabel(): string {
    const expiresAt = this.expiresAt;
    if (expiresAt === null) return "Ikuti jadwal pickup merchant";
    const remaining = expiresAt.getTime() - Date.now();
    if (remaining <= 0) return "Waktu pengambilan berakhir";
    const hours = Math.floor(remaining / 3_600_000);
    const minutes = Math.floor(remaining / 60_000) % 60;
    const seconds = Math.floor(remaining / 1000) % 60;
    if (hours >= 24) {
      const days = Math.floor(remaining / 86_400_000);
      return `${days} hari ${hours % 24} jam lagi`;
    }
    if (hours > 0) return `${hours} jam ${minutes} menit lagi`;
    return `${minutes} menit ${pad2(seconds)} detik lagi`;
  }

  get deadlineLabel(): string {
    const expiresAt = this.expiresAt;
    if (expiresAt === null) return this.order.bag.pickupWindow;
    const now = new Date();
    const sameDay =
      expiresAt.getFullYear() === now.getFullYear() &&
      expiresAt.getMonth() === now.getMonth() &&
      expiresAt.getDate() === now.getDate();
    const hour = pad2(expiresAt.getHours());
    const minute = pad2(expiresAt.getMinutes());
    if (sameDay) return `Hari ini pukul ${hour}.${minute}`;
    return `${expiresAt.getDate()}/${expiresAt.getMonth() + 1}/${expiresAt.getFullYear()} pukul ${hour}.${minute}`;
  }

  get title(): string {
    if (this.redeemed) return "Pesanan sudah diambil";
    if (this.cancelled) return "Pesanan dibatalkan";
    if (this.expired) return "Voucher kedaluwarsa";
    if (this.order.status === "pending") return "Pesanan sedang diproses";
    return "Pesanan siap diambil!";
  }

  get subtitle(): string {
    if (this.redeemed) {
      return "QR sudah dipindai dan tidak dapat digunakan kembali.";
    }
    if (this.cancelled) return "QR pickup dinonaktifkan untuk pesanan ini.";
    if (this.expired) {
      return "Waktu pengambilan telah berakhir dan QR dinonaktifkan.";
    }
    if (this.order.status === "pending") {
      return "QR akan tersedia setelah pesanan siap diambil.";
    }
    return "Tunjukkan QR aktif ini kepada kasir saat mengambil bag.";
  }
}

/**
 * The pickup voucher uses a short-lived token from the backend. The order
 * reference is never used as the QR payload.
 */
export function VoucherScreen({ order }: { order: OrderRecord }) {
  const [, rebuild] = useReducer((version: number) => version + 1, 0);
  const [state] = useState(() => new VoucherState(order, rebuild));
  useEffect(() => state.mount(), [state]);

  return (
    <Screen background={C.green}>
      <Scroll style={{ paddingTop: safeTop(16), paddingRight: 24, paddingBottom: safeBottom(32), paddingLeft: 24 }}>
        <StatusIcon state={state} />
        <Gap h={14} />
        <h1 style={{ ...display(23, { weight: 800, color: C.cream }), textAlign: "center" }}>{state.title}</h1>
        <Gap h={5} />
        <p style={{ ...ui(13.5, { color: C.greenMuted, height: 1.45 }), textAlign: "center" }}>{state.subtitle}</p>
        <Gap h={24} />
        <TicketCard state={state} />
        <Gap h={18} />
        <TimePill state={state} />
        <Gap h={18} />
        <GhostButton label="Lihat pesanan saya" color={C.greenMuted} onTap={() => AppNav.toOrders()} />
      </Scroll>
    </Screen>
  );
}

function StatusIcon({ state }: { state: VoucherState }) {
  const terminalProblem = state.cancelled || state.expired;
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: terminalProblem ? C.danger : C.greenBright,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <Icon
          name={terminalProblem ? "close_rounded" : state.redeemed ? "done_all_rounded" : "check_rounded"}
          size={34}
          color={C.white}
        />
      </div>
    </div>
  );
}

function TicketCard({ state }: { state: VoucherState }) {
  const order = state.order;
  return (
    <div
      style={{
        width: "100%",
        padding: 24,
        background: C.white,
        borderRadius: 24,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <QrContent state={state} />
      <div style={{ alignSelf: "stretch", height: 1, margin: "16px 0", background: C.border, flex: "none" }} />
      <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center" }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, overflow: "hidden", flex: "none" }}>
          <FoodImage path={order.bag.image} width={42} height={42} />
        </div>
        <Gap w={10} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...ui(14, { weight: 700, color: C.ink }), ...ellipsis }}>{order.bag.merchant.name}</div>
          <div style={{ ...ui(12.5, { color: C.body }), ...ellipsis }}>{`${order.quantity}× ${order.bag.title}`}</div>
        </div>
      </div>
      <Gap h={12} />
      {/* Expanded + SizedBox(12) + Flexible: each flexible child gets half the free space. */}
      <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center" }}>
        <div style={{ flex: "0 0 calc((100% - 12px) / 2)", minWidth: 0, ...ui(11.5, { color: C.muted }) }}>
          Referensi pesanan
        </div>
        <Gap w={12} />
        <div
          style={{
            flex: "0 1 auto",
            maxWidth: "calc((100% - 12px) / 2)",
            textAlign: "end",
            ...ui(12, { weight: 700, color: C.ink }),
            ...ellipsis,
          }}
        >
          {order.code}
        </div>
      </div>
    </div>
  );
}

function QrContent({ state }: { state: VoucherState }) {
  const rotate = () => void state.rotateToken();
  if (!state.canShowQr) {
    return (
      <div
        style={{
          width: "100%",
          padding: "26px 16px",
          background: C.neutralChip,
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Icon name={state.redeemed ? "qr_code_2_rounded" : "block_rounded"} size={64} color={C.muted} />
        <Gap h={10} />
        <p style={{ ...ui(12.5, { color: C.body, height: 1.45 }), textAlign: "center" }}>{state.subtitle}</p>
      </div>
    );
  }
  if (state.loadingToken) {
    return (
      <div style={{ width: "100%", height: 216, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner color={C.greenBright} label="Memuat" />
      </div>
    );
  }
  if (state.tokenError !== null) {
    return (
      <div
        style={{
          width: "100%",
          height: 216,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="qr_code_scanner_rounded" size={54} color={C.muted} />
        <Gap h={10} />
        <p role="alert" style={{ ...ui(12.5, { color: C.body, height: 1.45 }), textAlign: "center" }}>
          {state.tokenError}
        </p>
        <Gap h={8} />
        <TextButton label="Coba lagi" onTap={rotate} />
      </div>
    );
  }
  const token = state.order.pickupToken;
  if (token === null || token === "") {
    return (
      <div style={{ width: "100%", height: 216, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <TextButton label="Muat QR pickup" onTap={rotate} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <QrBox data={token} size={190} label={`QR pickup aktif untuk pesanan ${state.order.code}`} />
      <Gap h={9} />
      <p style={{ ...ui(10.8, { color: C.muted, height: 1.4 }), textAlign: "center" }}>
        Demi keamanan, QR diperbarui otomatis setiap 60 detik.
      </p>
      <TextButton
        label="Perbarui QR"
        icon="refresh_rounded"
        iconSize={16}
        onTap={state.loadingToken ? null : rotate}
      />
    </div>
  );
}

function TimePill({ state }: { state: VoucherState }) {
  const warning = state.expired || state.cancelled;
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div
        style={{
          maxWidth: "100%",
          padding: "11px 16px",
          background: warning ? C.dangerBg : C.greenDark,
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ maxWidth: "100%", display: "flex", alignItems: "center" }}>
          <Icon
            name={warning ? "event_busy_outlined" : "schedule"}
            size={16}
            color={warning ? C.danger : C.amber}
          />
          <Gap w={8} />
          <span
            style={{
              flex: "0 1 auto",
              minWidth: 0,
              textAlign: "center",
              ...ui(13, { weight: 700, color: warning ? C.danger : C.goldOnDark }),
            }}
          >
            {warning ? state.remainingLabel : `Batas: ${state.deadlineLabel}`}
          </span>
        </div>
        {!warning && state.expiresAt !== null ? (
          <>
            <Gap h={3} />
            <span style={ui(11.5, { color: C.greenMuted })}>{state.remainingLabel}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
