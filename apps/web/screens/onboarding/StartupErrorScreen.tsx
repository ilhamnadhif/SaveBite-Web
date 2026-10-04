"use client";

import { useState } from "react";
import { AppNav } from "../../lib/appNav";
import { FilledButton, TextButton } from "../../ui/buttons";
import { Icon } from "../../ui/Icon";
import { Spinner } from "../../ui/common";
import { C, display, ui } from "../../ui/theme";

/** `_StartupErrorScreen` from app_nav.dart: account data could not load. */
export function StartupErrorScreen({ message }: { message: string }) {
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    await AppNav.handleSignedIn();
    setBusy(false);
  };

  return (
    <div
      style={{
        flex: 1,
        background: "#FFFBF1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        paddingTop: "calc(28px + var(--safe-top))",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <Icon name="cloud_off_outlined" size={58} color="#1B5E43" />
        <h1 style={{ ...display(24, { weight: 800, color: C.ink, letterSpacing: 0 }), marginTop: 20 }}>
          SaveBite belum dapat dibuka
        </h1>
        <p style={{ ...ui(14, { color: C.body, height: 1.5 }), marginTop: 10 }} role="alert">
          {message}
        </p>
        <div style={{ marginTop: 24 }}>
          <FilledButton
            label={busy ? "Mencoba lagi…" : "Coba lagi"}
            icon={busy ? <Spinner size={16} strokeWidth={2} color={C.white} /> : "refresh"}
            onTap={busy ? null : () => void retry()}
          />
        </div>
        <div style={{ marginTop: 4 }}>
          <TextButton label="Keluar dari akun" onTap={busy ? null : () => void AppNav.logout()} />
        </div>
      </div>
    </div>
  );
}
