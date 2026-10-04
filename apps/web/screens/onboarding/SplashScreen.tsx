"use client";

import { AppLogo } from "../../ui/brand";
import { C, display, ui } from "../../ui/theme";

/** A1 Splash: the branded artwork on black, shown while startup routes. */
export function SplashScreen() {
  return (
    <div
      style={{
        flex: 1,
        background: C.black,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: "var(--safe-top)",
        paddingBottom: "var(--safe-bottom)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520, padding: "0 28px" }}>
        <img
          src="/images/savebite_brand.webp"
          alt="SaveBite, Every Bite Matters"
          decoding="async"
          fetchPriority="high"
          style={{ width: "100%", height: "auto", objectFit: "contain" }}
        />
      </div>
    </div>
  );
}

/** Startup failure screen that only shows a safe, user-facing message. */
export function StartupConfigurationErrorScreen(_props: { message: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: C.cream,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        overflowY: "auto",
      }}
    >
      <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <AppLogo size={84} />
        <h1 style={{ ...display(25, { weight: 800, color: C.ink }), marginTop: 24 }}>Aplikasi sedang tidak tersedia</h1>
        <p style={{ ...ui(14, { color: C.body, height: 1.55 }), marginTop: 12 }}>
          Aplikasi sedang mengalami kendala. Silakan coba lagi beberapa saat lagi.
        </p>
      </div>
    </div>
  );
}
