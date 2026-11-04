"use client";

import { AppNav } from "../../lib/appNav";
import { useAppState } from "../../lib/useAppState";
import { FilledButton } from "../../ui/buttons";
import { Icon } from "../../ui/Icon";
import { C, display, ui } from "../../ui/theme";

/** Shown instead of the workspace while an admin keeps the account suspended. */
export function SuspendedScreen() {
  const state = useAppState();
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        textAlign: "center",
        background: C.cream,
      }}
    >
      <Icon name="warning_amber_rounded" size={56} color={C.danger} />
      <h1 style={{ ...display(23, { weight: 800 }), marginTop: 18 }}>Akun ditangguhkan</h1>
      <p role="alert" style={{ ...ui(14, { color: C.body, height: 1.5 }), marginTop: 10, maxWidth: 320 }}>
        {state.suspendedReason ?? "Akun ini sedang tidak dapat digunakan."} Hubungi halo@savebite.id bila ini sebuah kesalahan.
      </p>
      <div style={{ marginTop: 22 }}>
        <FilledButton label="Keluar dari akun" onTap={() => void AppNav.logout()} />
      </div>
    </div>
  );
}
