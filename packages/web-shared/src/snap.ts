"use client";

import { publicConfig } from "./env";
import { log } from "./log";

declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        callbacks?: {
          onSuccess?: (result: unknown) => void;
          onPending?: (result: unknown) => void;
          onError?: (result: unknown) => void;
          onClose?: () => void;
        },
      ) => void;
    };
  }
}

const SCRIPT_ID = "midtrans-snap";

/**
 * Injects Midtrans Snap.js exactly once and resolves when it is ready.
 *
 * Two production bugs are handled here:
 *  - Concurrent callers (double-clicking "Bayar", or checkout + orders page at
 *    once) used to inject the script repeatedly. The in-flight promise is now
 *    shared, so the network request happens once.
 *  - A failed load left no way to retry. The cached promise is cleared on error
 *    so a later attempt can succeed after the network recovers.
 */
export function loadMidtransSnap(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Snap.js hanya dapat dimuat di browser."));
  }
  if (window.snap) return Promise.resolve();

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  if (existing && existing.dataset.pending === "true") {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Snap.js gagal dimuat.")), {
        once: true,
      });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const { midtransClientKey, midtransEnvironment } = publicConfig();
    if (!midtransClientKey) {
      reject(new Error("Midtrans client key belum dikonfigurasi."));
      return;
    }

    const host =
      midtransEnvironment === "production" ? "app.midtrans.com" : "app.sandbox.midtrans.com";
    const script = existing ?? document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://${host}/snap/snap.js`;
    script.async = true;
    script.setAttribute("data-client-key", midtransClientKey);
    script.dataset.pending = "true";

    script.onload = () => {
      script.dataset.loaded = "true";
      delete script.dataset.pending;
      if (!window.snap) {
        log.error("midtrans", "snap.js loaded but window.snap is missing");
        reject(new Error("Snap.js gagal dimuat."));
        return;
      }
      resolve();
    };
    script.onerror = () => {
      script.dataset.pending = "";
      delete script.dataset.pending;
      log.error("midtrans", "snap.js failed to load", { host });
      reject(new Error("Snap.js gagal dimuat. Periksa koneksi kamu lalu coba lagi."));
    };

    if (!existing) document.head.appendChild(script);
  });
}
