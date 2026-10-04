"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FilledButton } from "../../ui/buttons";
import { Gap, Spinner } from "../../ui/common";
import { Icon, type IconName } from "../../ui/Icon";
import { C, ui } from "../../ui/theme";
import { SaveBiteSnap } from "./snapBridge";
import type { SnapCheckoutSession } from "./snapCheckoutSession";

/** Height of the checkout area, the `SizedBox(height: 560)` of the mobile card. */
const SNAP_CHECKOUT_HEIGHT = 560;
/** Snap never showing its page by then means the iframe did not load. */
const SHOW_TIMEOUT_MS = 30_000;
/** How long a result shows the status check before offering the QRIS again. */
const VERIFY_HINT_MS = 6_000;

const LOAD_FAILED = "Halaman pembayaran belum dapat dimuat. Periksa koneksi lalu muat ulang.";
const OPEN_FAILED = "Halaman pembayaran belum dapat dibuka. Muat ulang untuk mencoba lagi.";

/**
 * `loading`: Snap's iframe is not visible yet. `shown`: the checkout is in the
 * card. `verifying`: Snap reported a result, the screen is asking the server.
 * `closed`: the checkout was closed without a final status. `popup`: this
 * Snap.js has no embed mode, so the checkout opened as its popup instead.
 */
type Phase = "loading" | "shown" | "verifying" | "closed" | "popup" | "failed";

/**
 * The web `SnapCheckoutView`. Mobile loads the Snap page in a WebView inside
 * the payment card; the web renders the same checkout inside the card with
 * Snap.js embed mode. The bridge discards the provider callback payload; this
 * view only forwards a hint so the screen syncs with the server.
 */
export function SnapCheckoutView({
  session,
  onStatusHint,
  onError,
  onReopen,
}: {
  session: SnapCheckoutSession;
  onStatusHint: () => void;
  onError: (message: string) => void;
  /** The customer opens the checkout again from the card (clears old errors). */
  onReopen: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState(0);
  // `identityHashCode(this)`: unique per mounted view.
  const instanceId = useId();
  const embedId = `snap-checkout-${instanceId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const container = useRef<HTMLDivElement | null>(null);
  // Like `widget.onStatusHint`, the callbacks are read when they fire.
  const callbacks = useRef({ onStatusHint, onError, onReopen });
  callbacks.current = { onStatusHint, onError, onReopen };
  const { token, clientKey, environment } = session;

  // Open the checkout, again whenever the token or key changes or the
  // customer asks for it again; unmounting hides this session.
  useEffect(() => {
    const host = container.current;
    if (host === null) return;
    let mounted = true;
    let shown = false;
    let verifyTimer: ReturnType<typeof setTimeout> | null = null;
    const sessionId = `${environment}:${token}:${instanceId}:${attempt}`;

    const fail = (message: string) => {
      if (!mounted) return;
      setPhase("failed");
      callbacks.current.onError(message);
    };
    const showTimer = setTimeout(() => {
      if (!shown) fail(LOAD_FAILED);
    }, SHOW_TIMEOUT_MS);

    // Snap adds its iframe hidden and only shows it once the page inside has
    // received the token, so the loading state stays until then.
    const observer = new MutationObserver(() => {
      if (!mounted) return;
      const frame = host.querySelector("iframe");
      if (!shown && frame !== null && frame.style.display !== "none") {
        shown = true;
        clearTimeout(showTimer);
        setPhase((current) => (current === "loading" ? "shown" : current));
      } else if (shown && frame === null) {
        // Snap removed its iframe without reporting a result.
        setPhase((current) => (current === "shown" ? "closed" : current));
      }
    });
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });

    const resultHandler = (kind: "status" | "closed") => {
      if (!mounted) return;
      clearTimeout(showTimer);
      if (kind === "status") {
        // Snap removes its iframe after a result. Show the check the screen
        // is doing now; a paid order leaves this screen before the timer.
        setPhase("verifying");
        verifyTimer = setTimeout(() => {
          if (mounted) setPhase("closed");
        }, VERIFY_HINT_MS);
      } else {
        setPhase("closed");
      }
      callbacks.current.onStatusHint();
    };

    SaveBiteSnap.embed(token, clientKey, environment, sessionId, embedId, resultHandler).then(
      (presentation) => {
        if (!mounted || presentation !== "popup") return;
        clearTimeout(showTimer);
        setPhase((current) => (current === "loading" ? "popup" : current));
      },
      () => {
        clearTimeout(showTimer);
        fail(OPEN_FAILED);
      },
    );
    return () => {
      mounted = false;
      clearTimeout(showTimer);
      if (verifyTimer !== null) clearTimeout(verifyTimer);
      observer.disconnect();
      SaveBiteSnap.hide(sessionId);
    };
  }, [token, clientKey, environment, instanceId, embedId, attempt]);

  const reopen = () => {
    setPhase("loading");
    setAttempt((value) => value + 1);
    callbacks.current.onReopen();
  };

  if (phase === "loading" || phase === "shown") {
    return (
      <div style={{ position: "relative", width: "100%", height: SNAP_CHECKOUT_HEIGHT, isolation: "isolate" }}>
        {phase === "loading" ? (
          <div
            role="status"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: C.white,
            }}
          >
            <Spinner color={C.green} strokeWidth={3} />
            <Gap h={14} />
            <p style={{ ...ui(12.5, { color: C.body }), textAlign: "center" }}>Memuat halaman pembayaran…</p>
          </div>
        ) : null}
        {/* Snap.js appends its iframe here and sizes it from this element. */}
        <div
          ref={container}
          id={embedId}
          style={{ position: "relative", zIndex: 1, width: "100%", height: SNAP_CHECKOUT_HEIGHT }}
        />
      </div>
    );
  }

  if (phase === "verifying") {
    return (
      <Panel
        status={<Spinner color={C.green} strokeWidth={3} />}
        title="Memeriksa status pembayaran…"
        body="Pesanan berlanjut otomatis setelah pembayaran terkonfirmasi."
      />
    );
  }

  if (phase === "popup") {
    return (
      <Panel
        status={<PanelIcon name="open_in_new_rounded" />}
        title="Pembayaran dibuka di jendela Midtrans"
        body="Selesaikan pembayaran di jendela tersebut. Status pesanan diperbarui otomatis."
        action={{ label: "Buka lagi", icon: "open_in_new_rounded", onTap: reopen }}
      />
    );
  }

  if (phase === "failed") {
    return (
      <Panel
        status={<PanelIcon name="web_asset_off_rounded" />}
        title="Halaman pembayaran belum tampil"
        body="Periksa koneksi internet, lalu coba lagi."
        action={{ label: "Coba lagi", icon: "refresh_rounded", onTap: reopen }}
      />
    );
  }

  return (
    <Panel
      status={<PanelIcon name="qr_code_2_rounded" />}
      title="Halaman pembayaran ditutup"
      body="Belum membayar? Tampilkan QRIS lagi untuk melanjutkan pembayaran."
      action={{ label: "Tampilkan QRIS lagi", icon: "qr_code_2_rounded", onTap: reopen }}
    />
  );
}

function PanelIcon({ name }: { name: IconName }) {
  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: C.greenSoftBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <Icon name={name} size={28} color={C.green} />
    </div>
  );
}

function Panel({
  status,
  title,
  body,
  action,
}: {
  status: ReactNode;
  title: string;
  body: string;
  action?: { label: string; icon: IconName; onTap: () => void };
}) {
  return (
    <div
      role="status"
      style={{
        width: "100%",
        padding: "30px 22px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      {status}
      <Gap h={14} />
      <p style={ui(14.5, { weight: 800, color: C.ink })}>{title}</p>
      <Gap h={6} />
      <p style={ui(12.5, { color: C.body, height: 1.45 })}>{body}</p>
      {action ? (
        <>
          <Gap h={16} />
          <FilledButton label={action.label} icon={action.icon} onTap={action.onTap} fontWeight={700} />
        </>
      ) : null}
    </div>
  );
}
