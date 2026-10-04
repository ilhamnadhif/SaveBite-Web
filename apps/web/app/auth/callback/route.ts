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
 * A failed code exchange sends the user back to the login screen with an
 * error *code* (never free text, so a crafted link cannot put arbitrary copy
 * on the screen), instead of a redirect that looks like a login that "did
 * nothing".
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = publicOrigin(url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), { fallback: "/" });

  if (code) {
    try {
      const supabase = await supabaseServer();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        log.error("auth.callback", "code exchange failed", { error: error.message });
        return failure(origin, next, "exchange_failed");
      }
    } catch (error) {
      log.error("auth.callback", "callback threw", {
        error: error instanceof Error ? error.message : String(error),
      });
      return failure(origin, next, "unavailable");
    }
  }

  // 303 so a browser re-issuing the request cannot replay the one-time code.
  return NextResponse.redirect(new URL(next, origin), { status: 303 });
}

/**
 * The origin the user is actually browsing.
 *
 * Inside the container the standalone server listens on 0.0.0.0:3000, so
 * `request.url` carries that address instead of the public one
 * (`http://<ip>:3002`, or the domain behind a proxy). The configured callback
 * URL is exactly where Supabase sends the browser back to, so its origin is
 * the public origin. The request origin is only a fallback for local setups
 * without the variable.
 */
function publicOrigin(requestUrl: URL): string {
  const configured = process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.origin;
    } catch {
      // An invalid value is reported by /api/ready; fall back below.
    }
  }
  return requestUrl.origin;
}

function failure(origin: string, next: string, error: "exchange_failed" | "unavailable"): NextResponse {
  const target = new URL("/login", origin);
  const merchant = next === "/merchant" || next.startsWith("/merchant/") || next.startsWith("/merchant?");
  target.searchParams.set("role", merchant ? "merchant" : "consumer");
  if (next !== "/" && next !== "/merchant") target.searchParams.set("next", next);
  target.searchParams.set("error", error);
  return NextResponse.redirect(target, { status: 303 });
}
