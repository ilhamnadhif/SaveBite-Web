import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "./lib/routes";

/**
 * Runs on every request. Three jobs:
 *
 *  1. Require a valid session for every application route. A guest opening
 *     the app is sent to the role fork (onboarding first on a new device),
 *     like the mobile app; a guest following a deep link goes straight to
 *     sign-in for that workspace and comes back to the link afterwards.
 *
 *  2. Keep the Supabase auth session fresh. `getUser()` triggers the `setAll`
 *     cookie-refresh callback, so it runs whenever a session cookie exists.
 *
 *  3. Attach the security headers.
 */

/** Supabase persists the session in a cookie named `sb-<project-ref>-auth-token`. */
const SESSION_COOKIE = /^sb-[a-z0-9-]+-auth-token(\.\d+)?$/i;

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => SESSION_COOKIE.test(cookie.name));
}

/**
 * Refreshed auth cookies are `Secure` only when the public origin is HTTPS.
 * Browsers drop `Secure` cookies sent over plain HTTP (e.g. `http://<ip>:3002`),
 * which would sign the user out on the next refresh. Mirrors
 * `authCookiesSecure()` in web-shared, inlined to keep the Edge bundle small.
 */
function authCookiesSecure(): boolean {
  const callback = process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL?.trim();
  if (callback) {
    try {
      return new URL(callback).protocol === "https:";
    } catch {
      // Reported by /api/ready; use the fallback below.
    }
  }
  return process.env.NODE_ENV === "production";
}

function loginRedirect(request: NextRequest, response: NextResponse, headers: Headers): NextResponse {
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const merchant = request.nextUrl.pathname === "/merchant" || request.nextUrl.pathname.startsWith("/merchant/");
  const destination = request.nextUrl.clone();
  destination.search = "";
  if (request.nextUrl.pathname === "/") {
    // Opening the app signed out: the role fork (the client shows onboarding
    // first on a device that has not seen it).
    destination.pathname = "/welcome";
  } else {
    destination.pathname = "/login";
    destination.searchParams.set("role", merchant ? "merchant" : "consumer");
    destination.searchParams.set("next", target);
  }

  const redirect = NextResponse.redirect(destination);
  // Keep any session refresh/deletion cookies returned by Supabase on the
  // redirect, as well as the security headers applied for this request.
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  for (const [key, value] of headers) redirect.headers.set(key, value);
  return redirect;
}

/**
 * Content Security Policy.
 *
 * Why `'unsafe-inline'` appears in `script-src`: every route except the OAuth
 * callback and the API handlers is prerendered at build time, so a per-request
 * nonce cannot be stamped into the HTML. A nonce-based policy here would be
 * either ignored (leaving a false sense of protection) or would force every page
 * to be server-rendered on every request, which is a large regression on the
 * single-vCPU target this ships to. This app renders no user HTML
 * (`dangerouslySetInnerHTML`, `eval` and `new Function` appear nowhere) and
 * React escapes by default, so the exploitable surface is script *sources*, and
 * those are pinned to our own origin plus Midtrans.
 *
 * What the policy does hard-lock, and what a nonce would not have improved:
 * no plugins (`object-src 'none'`), no base-tag hijack (`base-uri 'self'`), no
 * framing (`frame-ancestors 'none'`), no form exfiltration (`form-action
 * 'self'`), and a `connect-src` allowlist of exactly the two third parties the
 * app talks to.
 */
function buildCsp(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const connect = ["'self'"];

  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      connect.push(parsed.origin);
      // Supabase Realtime uses a websocket on the project's own host.
      connect.push(`${parsed.protocol === "http:" ? "ws" : "wss"}://${parsed.host}`);
    } catch {
      // An invalid URL is reported by /ready; omitting it here keeps the
      // policy well-formed instead of emitting a broken directive.
    }
  }

  connect.push(
    "wss://*.supabase.co",
    "https://api.midtrans.com",
    "https://app.midtrans.com",
    "https://app.sandbox.midtrans.com",
    "https://*.midtrans.com",
  );

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // `next dev` evaluates modules with eval (React Refresh, source maps);
    // production builds never need it.
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://app.midtrans.com https://app.sandbox.midtrans.com`,
    // React inline styles and Leaflet's imperative style writes both require this.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    // Merchant uploads live in Supabase Storage; OSM serves the map tiles.
    "img-src 'self' blob: data: https:",
    `connect-src ${connect.join(" ")}`,
    "frame-src https://app.midtrans.com https://app.sandbox.midtrans.com https://*.midtrans.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

function securityHeaders(request: NextRequest): Headers {
  const headers = new Headers({
    "Content-Security-Policy": buildCsp(),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Geolocation: discovery, the map, and the store location. Camera: the
    // merchant's pickup QR scanner.
    "Permissions-Policy": "geolocation=(self), camera=(self), microphone=(), payment=(self), usb=()",
  });

  // Only advertise HSTS when the request actually arrived over TLS, otherwise a
  // plain-HTTP probe would pin browsers to https for the local host.
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const isHttps = forwardedProto
    ? forwardedProto.split(",")[0].trim() === "https"
    : request.nextUrl.protocol === "https:";

  if (isHttps) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return headers;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const headers = securityHeaders(request);
  for (const [key, value] of headers) response.headers.set(key, value);

  // The explicit demo build has no server session: the client app runs on
  // in-memory sample data and handles its own (local) login.
  const demo = process.env.NEXT_PUBLIC_SAVEBITE_DEMO === "true";
  const requiresAuth = !demo && !isPublicPath(request.nextUrl.pathname);
  if (requiresAuth && !hasSessionCookie(request)) {
    return loginRedirect(request, response, headers);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without credentials we cannot refresh anything, but the security headers
  // must still be applied so a misconfigured deploy is not left unprotected.
  if (!url || !key) {
    return requiresAuth ? loginRedirect(request, response, headers) : response;
  }
  if (!hasSessionCookie(request)) return response;

  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim() || undefined;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        // Reflect the new cookies onto the request so the renderer sees the
        // refreshed session, and onto the response so the browser stores it.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, {
            ...options,
            ...(domain ? { domain } : {}),
            path: "/",
            sameSite: "lax",
            secure: authCookiesSecure(),
          }),
        );
        for (const [headerKey, headerValue] of headers) {
          response.headers.set(headerKey, headerValue);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    // An expired or tampered token is a client problem, not a server fault.
    // Protected routes require a valid user before any application page is
    // rendered; public auth routes keep the diagnostic header only.
    if (requiresAuth) return loginRedirect(request, response, headers);
    response.headers.set("x-auth-state", "anonymous");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
