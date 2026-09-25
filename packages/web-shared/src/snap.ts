"use client";

declare global {
  interface Window {
    snap?: { pay: (token: string, callbacks?: { onSuccess?: (result: unknown) => void; onPending?: (result: unknown) => void; onError?: (result: unknown) => void; onClose?: () => void }) => void };
  }
}

export function loadMidtransSnap() {
  return new Promise<void>((resolve, reject) => {
    if (window.snap) { resolve(); return; }
    const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY;
    if (!clientKey) { reject(new Error("Midtrans client key belum dikonfigurasi.")); return; }
    const script = document.createElement("script");
    const environment = process.env.NEXT_PUBLIC_MIDTRANS_ENVIRONMENT === "production" ? "app" : "app.sandbox";
    script.src = `https://${environment}.midtrans.com/snap/snap.js`;
    script.setAttribute("data-client-key", clientKey);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Snap.js gagal dimuat."));
    document.head.appendChild(script);
  });
}
