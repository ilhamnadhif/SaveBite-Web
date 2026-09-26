/**
 * Redirect-target sanitisation.
 *
 * `next` query parameters flow into `NextResponse.redirect(...)` on the OAuth
 * callback and into `router.push(...)` on the login screen. Without validation
 * they are a textbook open redirect: an attacker sends
 * `/login?next=@evil.com` or `/auth/callback?code=...&next=https://evil.com`
 * and the victim lands on a credential-harvesting clone after a real Google
 * login. Only same-origin absolute *paths* are ever accepted.
 */

const PROBE_ORIGIN = "https://savebite.invalid";

/** Control characters can split headers/URLs and are never legitimate here. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type SafeNextOptions = {
  /** Used when the candidate is missing or rejected. Defaults to "/". */
  fallback?: string;
  /**
   * When set, additionally require the accepted path to start with this
   * prefix. Used to stop a consumer session from being bounced into the
   * merchant workspace and vice versa.
   */
  requirePrefix?: "/" | "/merchant";
};

/**
 * Returns `candidate` when it is a safe same-origin path, otherwise
 * `options.fallback`.
 */
export function safeNextPath(
  candidate: string | null | undefined,
  options: SafeNextOptions = {},
): string {
  const fallback = options.fallback ?? "/";
  if (typeof candidate !== "string") return fallback;

  const value = candidate.trim();
  if (!value.startsWith("/")) return fallback;

  // `//host` and `/\host` are both parsed as protocol-relative URLs by
  // browsers, which would escape our origin.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (CONTROL_CHARS.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }

  // Belt and braces: the parsed URL must still be same-origin and path-only.
  if (url.origin !== PROBE_ORIGIN) return fallback;
  if (url.protocol !== "https:" || !url.pathname.startsWith("/")) return fallback;
  if (url.username || url.password) return fallback;

  const normalized = `${url.pathname}${url.search}${url.hash}`;

  if (options.requirePrefix) {
    const prefix = options.requirePrefix;
    const matches =
      prefix === "/merchant"
        ? normalized === "/merchant" || normalized.startsWith("/merchant/") || normalized.startsWith("/merchant?") || normalized.startsWith("/merchant#")
        : normalized === "/" || !normalized.startsWith("/merchant");
    if (!matches) return fallback;
  }

  return normalized;
}

/** `true` when `candidate` would be accepted by {@link safeNextPath}. */
export function isSafeNextPath(candidate: string | null | undefined): boolean {
  return safeNextPath(candidate, { fallback: "\u0000" }) !== "\u0000";
}

/**
 * Builds the absolute OAuth redirect URL. Falls back to a same-origin
 * `/auth/callback` when `NEXT_PUBLIC_AUTH_CALLBACK_URL` is unusable, so a
 * misconfiguration degrades to a working localhost flow instead of sending
 * users to an unrelated host.
 */
export function authCallbackUrl(origin: string, next: string): string {
  const configured = process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL?.trim();
  const base = configured ? safeAbsoluteOrigin(configured) : `${origin}/auth/callback`;
  const url = new URL(base);
  url.searchParams.set("next", next);
  return url.toString();
}

function safeAbsoluteOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    /* fall through */
  }
  return "http://localhost:3000/auth/callback";
}
