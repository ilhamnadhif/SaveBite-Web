import { NextResponse } from "next/server";
import { log, safeNextPath } from "@savebite/web-shared";
import { supabaseServer } from "@savebite/web-shared/server";

export const dynamic = "force-dynamic";

/**
 * OAuth (PKCE) callback.
 *
 * `next` is fully attacker-controlled, so it is run through `safeNextPath`
 * before it reaches `NextResponse.redirect`. Without that check,
 * `/auth/callback?code=<valid>&next=https://evil.example` turns a successful
 * Google login into a redirect to a phishing page.
 *
 * A failed code exchange returns 502 with a user-facing page instead of a silent
 * redirect, so a broken/misconfigured redirect URI is visible instead of
 * looking like a login that "did nothing".
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), { fallback: "/" });

  if (code) {
    try {
      const supabase = await supabaseServer();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        log.error("auth.callback", "code exchange failed", { error: error.message });
        return failure(url.origin, "Sesi tidak dapat dibuat. Silakan coba masuk kembali.");
      }
    } catch (error) {
      log.error("auth.callback", "callback threw", {
        error: error instanceof Error ? error.message : String(error),
      });
      return failure(url.origin, "Layanan sedang tidak tersedia. Silakan coba lagi.");
    }
  }

  // 303 so a browser re-issuing the request cannot replay the one-time code.
  return NextResponse.redirect(new URL(next, url.origin), { status: 303 });
}

function failure(origin: string, message: string): NextResponse {
  const target = new URL("/login", origin);
  target.searchParams.set("error", message);
  return NextResponse.redirect(target, { status: 303 });
}
