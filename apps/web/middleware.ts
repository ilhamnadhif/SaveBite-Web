import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs on every request. Two jobs:
 *
 *  1. Keep the Supabase auth session fresh. `getUser()` is what triggers the
 *     `setAll` cookie-refresh callback, so it must run whenever a session cookie
 *     exists. It is skipped for anonymous traffic: the previous version made a
 *     network round trip to Supabase on *every* request, including the large
 *     majority of visitors who are browsing the catalogue signed out.
 *
 *  2. Attach the security headers.
 */

/** Supabase persists the session in a cookie named `sb-<project-ref>-auth-token`. */
const SESSION_COOKIE = /^sb-[a-z0-9-]+-auth-token(\.\d+)?$/i;

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => SESSION_COOKIE.test(cookie.name));
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
    "script-src 'self' 'unsafe-inline' https://app.midtrans.com https://app.sandbox.midtrans.com",
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
    // Geolocation is used by the map and by "use my location" in store setup.
    "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=(self), usb=()",
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without credentials we cannot refresh anything, but the security headers
  // must still be applied so a misconfigured deploy is not left unprotected.
  if (!url || !key || !hasSessionCookie(request)) return response;

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
            secure: process.env.NODE_ENV === "production" || options.secure === true,
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
    // Surfaced for debugging; the app renders its own sign-in state.
    response.headers.set("x-auth-state", "anonymous");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
