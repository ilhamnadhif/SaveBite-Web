"use client";
import { LoginCard } from "@savebite/web-shared";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");
  const next = params.get("next") ?? "";
  const initialMerchant = params.get("role") === "merchant" || next.startsWith("/merchant");
  return <LoginCard key={initialMerchant ? "merchant" : "consumer"} initialMerchant={initialMerchant} error={error}/>;
}
export default function LoginPage() { return <Suspense fallback={<div className="loading-screen">Memuat…</div>}><LoginContent/></Suspense>; }
