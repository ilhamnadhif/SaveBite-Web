"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Spinner } from "../../ui/common";
import { C } from "../../ui/theme";
import { SaveBiteSnap } from "./snapBridge";
import type { SnapCheckoutSession } from "./snapCheckoutSession";

/**
 * The web `SnapCheckoutView` (`snap_checkout_view_web.dart`): opens the
 * official in-page Snap.js popup. The bridge discards the provider callback
 * payload; this view only forwards a hint so the screen syncs with the server.
 */
export function SnapCheckoutView({
  session,
  onStatusHint,
  onError,
}: {
  session: SnapCheckoutSession;
  onStatusHint: () => void;
  onError: (message: string) => void;
}) {
  const [opening, setOpening] = useState(true);
  // `identityHashCode(this)`: unique per mounted view.
  const instanceId = useId();
  // Like `widget.onStatusHint`, the callbacks are read when they fire.
  const callbacks = useRef({ onStatusHint, onError });
  callbacks.current = { onStatusHint, onError };
  const { token, clientKey, environment } = session;

  // `_configureSession` + `_open`, again whenever the token or key changes
  // (`didUpdateWidget`); `dispose` hides the popup of this session.
  useEffect(() => {
    let mounted = true;
    const sessionId = `${environment}:${token}:${instanceId}`;
    const resultHandler = () => {
      if (!mounted) return;
      setOpening(false);
      callbacks.current.onStatusHint();
    };
    setOpening(true);
    try {
      void SaveBiteSnap.pay(token, clientKey, environment, sessionId, resultHandler).catch(() => {
        if (!mounted) return;
        setOpening(false);
        callbacks.current.onError("Halaman pembayaran belum dapat dibuka. Muat ulang untuk mencoba lagi.");
      });
    } catch {
      setOpening(false);
      callbacks.current.onError("Komponen pembayaran belum siap. Muat ulang untuk mencoba lagi.");
    }
    return () => {
      mounted = false;
      SaveBiteSnap.hide(sessionId);
    };
  }, [token, clientKey, environment, instanceId]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: C.white,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {opening ? <Spinner /> : null}
    </div>
  );
}
