/**
 * Typed, validated access to configuration.
 *
 * Rules this module enforces:
 *  - Every value is read with a *literal* `process.env.X` access so that the
 *    Next.js compiler can inline `NEXT_PUBLIC_*` into the client bundle.
 *  - Nothing throws at import time. Modules are evaluated during `next build`
 *    and during test collection, so validation is lazy and happens on first
 *    use instead. A misconfigured deploy still fails fast, with an actionable
 *    message naming the missing variable.
 *  - Invalid values are rejected rather than silently coerced (e.g. an
 *    unrecognised Midtrans environment would otherwise silently load the
 *    sandbox in production).
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type MidtransEnvironment = "sandbox" | "production";

const isBrowser = typeof window !== "undefined";

function read(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new ConfigError(
      `Environment variable ${name} is not configured. ` +
        `Copy .env.example to .env and fill it in before starting the app.`,
    );
  }
  return value;
}

export type PublicConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  authCallbackUrl: string;
  /** Undefined on localhost; otherwise e.g. ".savebite.com" / "savebite.com". */
  cookieDomain: string | undefined;
  midtransClientKey: string | undefined;
  midtransEnvironment: MidtransEnvironment;
};

let cached: PublicConfig | undefined;

/**
 * Validated public configuration. Throws `ConfigError` when a required
 * variable is missing or malformed.
 */
export function publicConfig(): PublicConfig {
  if (cached) return cached;

  const supabaseUrl = requireValue("NEXT_PUBLIC_SUPABASE_URL", read(process.env.NEXT_PUBLIC_SUPABASE_URL));
  const supabaseAnonKey = requireValue(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    read(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );

  // Fail fast on a typo'd URL instead of producing confusing network errors.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new ConfigError("NEXT_PUBLIC_SUPABASE_URL must be an absolute https:// URL.");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new ConfigError("NEXT_PUBLIC_SUPABASE_URL must use http or https.");
  }

  const rawEnvironment = read(process.env.NEXT_PUBLIC_MIDTRANS_ENVIRONMENT) ?? "sandbox";
  if (rawEnvironment !== "sandbox" && rawEnvironment !== "production") {
    throw new ConfigError(
      `NEXT_PUBLIC_MIDTRANS_ENVIRONMENT must be "sandbox" or "production", received "${rawEnvironment}".`,
    );
  }

  const cookieDomain = read(process.env.NEXT_PUBLIC_COOKIE_DOMAIN);
  if (cookieDomain && !/^\.?[a-z0-9.-]+$/i.test(cookieDomain)) {
    throw new ConfigError("NEXT_PUBLIC_COOKIE_DOMAIN must be a bare domain such as .savebite.com.");
  }

  cached = {
    supabaseUrl,
    supabaseAnonKey,
    authCallbackUrl: requireValue(
      "NEXT_PUBLIC_AUTH_CALLBACK_URL",
      read(process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL),
    ),
    cookieDomain,
    midtransClientKey: read(process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY),
    midtransEnvironment: rawEnvironment,
  };
  return cached;
}

/** Test seam: drop the memoised config so env changes are picked up. */
export function resetConfigCache(): void {
  cached = undefined;
}

/**
 * Non-throwing snapshot for the health endpoint. Reports which required
 * variables are present *without* echoing their values.
 */
export function configStatus(): {
  ok: boolean;
  missing: string[];
  invalid: string[];
  midtransConfigured: boolean;
  cookieDomainShared: boolean;
} {
  const missing: string[] = [];
  const invalid: string[] = [];

  const required: Array<[string, string | undefined]> = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
    ["NEXT_PUBLIC_AUTH_CALLBACK_URL", process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL],
  ];
  for (const [name, value] of required) if (!read(value)) missing.push(name);

  const url = read(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (url) {
    try {
      new URL(url);
    } catch {
      invalid.push("NEXT_PUBLIC_SUPABASE_URL");
    }
  }

  const environment = read(process.env.NEXT_PUBLIC_MIDTRANS_ENVIRONMENT) ?? "sandbox";
  if (environment !== "sandbox" && environment !== "production") {
    invalid.push("NEXT_PUBLIC_MIDTRANS_ENVIRONMENT");
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    midtransConfigured: Boolean(read(process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY)),
    cookieDomainShared: Boolean(read(process.env.NEXT_PUBLIC_COOKIE_DOMAIN)),
  };
}

/**
 * Cookie attributes shared by the browser and server Supabase clients.
 *
 * `SameSite=Lax` (not `Strict`) is required: the OAuth callback returns from
 * google.com as a top-level GET navigation, and `Strict` would drop the
 * just-set session cookie. `Secure` is forced on in production, regardless of
 * protocol, because a production deployment behind a TLS-terminating proxy is
 * the expected setup.
 */
export function authCookieOptions(): {
  domain?: string;
  path: string;
  sameSite: "lax";
  secure: boolean;
} {
  const domain = read(process.env.NEXT_PUBLIC_COOKIE_DOMAIN);
  return {
    ...(domain ? { domain } : {}),
    path: "/",
    sameSite: "lax",
    secure: isBrowser ? window.location.protocol === "https:" : process.env.NODE_ENV === "production",
  };
}
