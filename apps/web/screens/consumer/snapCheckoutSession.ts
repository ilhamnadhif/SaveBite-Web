/**
 * Snap checkout values that passed client-side validation — a port of
 * `lib/services/snap_checkout_session.dart`.
 *
 * This validation is not the source of truth for the payment status. It only
 * makes sure the app never loads a URL or script outside the Midtrans
 * endpoints it expects. "Paid" always comes from the backend.
 */
import { publicConfig, type MidtransEnvironment } from "@savebite/web-shared";

/**
 * The parts of a Dart `Uri` the payment validators read.
 *
 * Parsed by hand on purpose: the WHATWG `URL` parser silently repairs input
 * that Dart's `Uri` rejects (`https:host`, `https:///host`, backslashes as
 * slashes, stripped tabs, percent-encoded hosts), which would widen the
 * allowlists below.
 */
export type PaymentUri = {
  /** Lower-cased. */
  readonly scheme: string;
  readonly userInfo: string;
  /** Lower-cased. */
  readonly host: string;
  /** The explicit port, else the scheme default (443 / 80 / 0), like Dart. */
  readonly port: number;
  /** A `?` is present, even with an empty query. */
  readonly hasQuery: boolean;
  /** A `#` is present, even with an empty fragment. */
  readonly hasFragment: boolean;
  /** Decoded segments; a leading slash is ignored, `/` alone is empty. */
  readonly pathSegments: readonly string[];
};

const URI_SHAPE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;
const HOST_AND_PORT = /^([A-Za-z0-9.-]*)(?::([0-9]*))?$/;

function decodePathSegments(path: string): string[] | null {
  const relative = path.startsWith("/") ? path.slice(1) : path;
  if (relative === "") return [];
  try {
    return relative.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

/**
 * `Uri.tryParse` for absolute `scheme://authority/path` URLs. Null for input
 * Dart would reject or would have to percent-encode (anything outside
 * printable ASCII, backslashes), since such input can never satisfy the
 * payment validators anyway.
 */
export function parsePaymentUri(raw: string): PaymentUri | null {
  if (!/^[\x21-\x7E]+$/.test(raw) || raw.includes("\\")) return null;
  const match = URI_SHAPE.exec(raw);
  if (!match) return null;
  const [, rawScheme, authority, path, query, fragment] = match;
  const at = authority.lastIndexOf("@");
  const hostAndPort = HOST_AND_PORT.exec(authority.slice(at + 1));
  if (!hostAndPort) return null;
  const pathSegments = decodePathSegments(path);
  if (!pathSegments) return null;
  const scheme = rawScheme.toLowerCase();
  const explicitPort = hostAndPort[2];
  return {
    scheme,
    userInfo: at >= 0 ? authority.slice(0, at) : "",
    host: hostAndPort[1].toLowerCase(),
    port: explicitPort ? Number.parseInt(explicitPort, 10) : scheme === "https" ? 443 : scheme === "http" ? 80 : 0,
    hasQuery: query !== undefined,
    hasFragment: fragment !== undefined,
    pathSegments,
  };
}

/** Dart `_isSafeHttpsUri`. */
export function isSafeHttpsUri(uri: PaymentUri): boolean {
  return uri.scheme === "https" && uri.host !== "" && uri.port === 443 && uri.userInfo === "";
}

/**
 * Dart `uri.toString()` for a validated https URL: lower-case host, default
 * port dropped, path rebuilt from its (already allowlisted) segments.
 */
export function canonicalHttpsUrl(uri: PaymentUri): string {
  return `https://${uri.host}/${uri.pathSegments.join("/")}`;
}

const CLIENT_KEY_PATTERN = /^Mid-client-[A-Za-z0-9_-]{8,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;

type ClientConfig = { clientKey: string; environment: string; supabaseUrl: string };

/** `Env.midtransClientKey` / `Env.midtransEnvironment` / `Env.supabaseUrl`. */
function clientConfig(): ClientConfig {
  try {
    const config = publicConfig();
    return {
      clientKey: config.midtransClientKey ?? "",
      environment: config.midtransEnvironment,
      supabaseUrl: config.supabaseUrl,
    };
  } catch {
    // Missing configuration (e.g. the demo build): nothing can validate.
    return { clientKey: "", environment: "", supabaseUrl: "" };
  }
}

export class SnapCheckoutSession {
  private constructor(
    /** The validated Snap redirect document. */
    readonly redirectUri: string,
    readonly token: string,
    readonly clientKey: string,
    readonly environment: MidtransEnvironment,
    readonly supabaseOrigin: string,
  ) {}

  static tryParse(
    rawRedirectUrl: string | null | undefined,
    {
      snapToken,
      clientKey,
      environment,
      supabaseUrl,
    }: {
      snapToken?: string | null;
      clientKey?: string | null;
      environment?: string | null;
      supabaseUrl?: string | null;
    } = {},
  ): SnapCheckoutSession | null {
    const config = clientConfig();
    const raw = rawRedirectUrl?.trim();
    const effectiveToken = snapToken?.trim() ?? "";
    const effectiveKey = (clientKey ?? config.clientKey).trim();
    const effectiveEnvironment = (environment ?? config.environment).trim().toLowerCase();
    const effectiveSupabaseUrl = (supabaseUrl ?? config.supabaseUrl).trim();
    if (
      raw === undefined ||
      raw === "" ||
      !TOKEN_PATTERN.test(effectiveToken) ||
      !CLIENT_KEY_PATTERN.test(effectiveKey) ||
      (effectiveEnvironment !== "sandbox" && effectiveEnvironment !== "production")
    ) {
      return null;
    }

    const redirect = parsePaymentUri(raw);
    const supabase = parsePaymentUri(effectiveSupabaseUrl);
    if (
      redirect === null ||
      supabase === null ||
      !isSafeHttpsUri(redirect) ||
      !isSafeHttpsUri(supabase) ||
      !supabase.host.endsWith(".supabase.co")
    ) {
      return null;
    }

    const expectedHost = effectiveEnvironment === "sandbox" ? "app.sandbox.midtrans.com" : "app.midtrans.com";
    if (redirect.host !== expectedHost || redirect.hasQuery || redirect.hasFragment) {
      return null;
    }

    const segments = redirect.pathSegments;
    const isV2 = segments.length === 4 && segments[0] === "snap" && segments[1] === "v2" && segments[2] === "vtweb";
    const isV3 = segments.length === 4 && segments[0] === "snap" && segments[1] === "v3" && segments[2] === "redirection";
    const isV4 = segments.length === 4 && segments[0] === "snap" && segments[1] === "v4" && segments[2] === "redirection";
    // The redirect resource ID and the Snap.js token are independent values in
    // Midtrans' response. Validate both, but never assume they are equal.
    if ((!isV2 && !isV3 && !isV4) || !TOKEN_PATTERN.test(segments[3])) {
      return null;
    }

    return new SnapCheckoutSession(
      canonicalHttpsUrl(redirect),
      effectiveToken,
      effectiveKey,
      effectiveEnvironment,
      `https://${supabase.host}`,
    );
  }
}
