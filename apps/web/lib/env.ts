/**
 * App-level flags and the client configuration check, mirroring
 * `lib/config/env.dart`.
 */
import { publicConfig } from "@savebite/web-shared";

/**
 * Demo mode must be requested explicitly. Without it, a missing configuration
 * shows an error screen and never silently runs on sample data.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_SAVEBITE_DEMO === "true";

const E2E_REQUESTED = process.env.NEXT_PUBLIC_SAVEBITE_E2E === "true";

/** Midtrans sandbox profile (`MIDTRANS_ENVIRONMENT=sandbox`). */
export function midtransSandbox(): boolean {
  try {
    return publicConfig().midtransEnvironment === "sandbox";
  } catch {
    return false;
  }
}

/**
 * Internal test tooling (test-account login, staging scan input). Only ever on
 * with the sandbox profile, never in production.
 */
export function e2eMode(): boolean {
  return E2E_REQUESTED && midtransSandbox();
}

/** `Env._looksLikeServerSecret`: an `sb_secret_` key or a service-role JWT. */
function looksLikeServerSecret(key: string): boolean {
  const normalized = key.trim();
  if (normalized.startsWith("sb_secret_")) return true;
  const parts = normalized.split(".");
  if (parts.length !== 3) return false;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json: unknown = JSON.parse(atob(padded));
    return typeof json === "object" && json !== null && (json as Record<string, unknown>).role === "service_role";
  } catch {
    return false;
  }
}

function isLocalSupabase(url: URL): boolean {
  return process.env.NODE_ENV !== "production" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/**
 * `Env.configurationError` / `_configurationProblem`: null when the public
 * client configuration is usable, otherwise the Indonesian reason.
 */
export function configurationError(): string | null {
  if (DEMO_MODE) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !key) {
    return "Konfigurasi Supabase belum lengkap. Isi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY, lalu build ulang aplikasi.";
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  const hostedSupabase = parsed !== null && parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
  if (!parsed || (!hostedSupabase && !isLocalSupabase(parsed))) {
    return "SUPABASE_URL tidak valid. Gunakan URL HTTPS project Supabase.";
  }
  if (looksLikeServerSecret(key)) {
    return "Key server/secret tidak boleh dibundel ke aplikasi. Gunakan publishable key atau anon key Supabase.";
  }
  const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY?.trim() ?? "";
  if (!/^Mid-client-[A-Za-z0-9_-]{8,128}$/.test(clientKey)) {
    return "MIDTRANS_CLIENT_KEY tidak valid. Gunakan Client Key publik, bukan Server Key.";
  }
  const environment = (process.env.NEXT_PUBLIC_MIDTRANS_ENVIRONMENT?.trim() || "sandbox").toLowerCase();
  if (environment !== "sandbox" && environment !== "production") {
    return "MIDTRANS_ENVIRONMENT harus bernilai sandbox atau production.";
  }
  if (E2E_REQUESTED && environment !== "sandbox") {
    return "SAVEBITE_E2E hanya boleh digunakan dengan profile sandbox.";
  }
  try {
    // The shared validator also covers the OAuth callback URL and cookie domain.
    publicConfig();
  } catch {
    return "Konfigurasi aplikasi tidak valid. Periksa variabel NEXT_PUBLIC_* lalu build ulang aplikasi.";
  }
  return null;
}
