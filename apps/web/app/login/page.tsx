"use client";

import { LoginCard } from "@savebite/web-shared";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");
  const next = params.get("next") ?? "";
  const initialMerchant = params.get("role") === "merchant" || next.startsWith("/merchant");
  return (
    <LoginCard
      // Remount when the role flips so the picker state cannot disagree with
      // the URL the user actually landed on.
      key={initialMerchant ? "merchant" : "consumer"}
      initialMerchant={initialMerchant}
      error={error}
      // The value is re-validated inside LoginCard; it is never trusted as-is.
      next={next || undefined}
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="loading-screen">Memuat…</div>}>
      <LoginContent />
    </Suspense>
  );
}
