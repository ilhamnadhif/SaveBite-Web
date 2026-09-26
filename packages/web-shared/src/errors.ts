/**
 * Turning raw Supabase/Postgres failures into messages that are safe to show a
 * user, while keeping the full detail available in the logs.
 *
 * Raw `error.message` values leak schema names, SQL fragments and constraint
 * details. The previous behaviour (`e.message` straight into the UI) surfaced
 * all of that. We now:
 *   1. classify the error (PostgREST code, SQLSTATE, or a known RPC message),
 *   2. return an Indonesian, user-actionable sentence,
 *   3. log the original error with context.
 */
import { log } from "./log";

export type ClassifiedError = {
  /** Safe to render in the UI. */
  message: string;
  /** Machine-readable classification for tests and metrics. */
  kind: string;
  /** True when retrying the exact same request could plausibly succeed. */
  retryable?: boolean;
};

type Rule = { kind: string; message: string; retryable?: boolean };

/** PostgREST `code` and Postgres `SQLSTATE` mappings. */
const BY_CODE: Record<string, Rule> = {
  PGRST116: { kind: "not_found", message: "Data tidak ditemukan atau tidak lagi tersedia." },
  PGRST301: { kind: "jwt_expired", message: "Sesi kamu sudah berakhir. Silakan masuk kembali." },
  PGRST302: { kind: "permission", message: "Akses ditolak untuk data ini." },
  "23505": { kind: "duplicate", message: "Data ini sudah pernah dibuat." },
  "23503": { kind: "foreign_key", message: "Data masih terhubung ke data lain dan tidak bisa diubah." },
  "23502": { kind: "validation", message: "Ada kolom wajib yang belum diisi." },
  "23514": { kind: "validation", message: "Nilai yang dimasukkan tidak valid." },
  "22003": { kind: "validation", message: "Nilai angka di luar batas yang diperbolehkan." },
  "22P02": { kind: "validation", message: "Format data tidak dikenali." },
  "42501": { kind: "permission", message: "Akses ditolak. Pastikan akun kamu memiliki izin." },
  "28P01": { kind: "auth", message: "Autentikasi database gagal. Periksa konfigurasi aplikasi." },
  "40001": { kind: "conflict", message: "Sesi kedaluwarsa. Silakan coba lagi.", retryable: true },
  "40P01": { kind: "deadlock", message: "Terjadi konflik sesaat. Silakan coba lagi.", retryable: true },
  "57014": { kind: "timeout", message: "Permintaan terlalu lama. Silakan coba lagi.", retryable: true },
  "08006": { kind: "unavailable", message: "Layanan sedang tidak tersedia. Coba lagi sebentar lagi.", retryable: true },
  "08003": { kind: "unavailable", message: "Layanan sedang tidak tersedia. Coba lagi sebentar lagi.", retryable: true },
  "53300": { kind: "unavailable", message: "Layanan sedang sibuk. Coba lagi sebentar lagi.", retryable: true },
};

/**
 * `raise exception` messages emitted by the SaveBite RPCs. These are authored
 * by us and carry no schema detail, so they are safe (and useful) to surface
 * verbatim.
 */
const BY_RPC_MESSAGE: Array<[RegExp, string, string]> = [
  [/^not authenticated$/i, "auth", "Sesi kamu sudah berakhir. Silakan masuk kembali."],
  [/^order not found$/i, "not_found", "Pesanan tidak ditemukan."],
  [/^order is not redeemable$/i, "state", "Pesanan belum siap diambil atau pembayaran belum terverifikasi."],
  [/^order has expired$/i, "expired", "Masa berlaku pesanan sudah berakhir."],
  [/^pickup window has not started$/i, "window", "Jendela pickup belum dimulai."],
  [/^pickup window has ended$/i, "window", "Jendela pickup sudah berakhir."],
  [/^merchant not found$/i, "not_found", "Toko tidak ditemukan."],
];

/** Patterns proving a message contains raw database internals. */
const LEAKY = /(select\s|insert\s|update\s|delete\s|from\s+public\.|pg_catalog|pg_[a-z_]+\(|stack\s*trace|\bat line \d+|supabase\.co|postgres(ql)?:\/\/)/i;

const GENERIC: ClassifiedError = {
  kind: "unknown",
  message: "Terjadi kendala. Coba lagi sebentar.",
  retryable: true,
};

/** Long opaque blobs (JWTs, Supabase refresh/service keys) must never be echoed. */
const OPAQUE_TOKEN = /\b(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?:sb_(?:secret|publishable)_|sbp_)[A-Za-z0-9_-]{20,})\b/g;

function scrub(message: string): string {
  return message.replace(OPAQUE_TOKEN, "[redacted]");
}

function readField(error: unknown, field: string): string | undefined {
  if (error && typeof error === "object" && field in error) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Classifies an unknown thrown value without logging it. */
export function classifyError(error: unknown): ClassifiedError {
  if (!error) return GENERIC;

  const rawMessage = readField(error, "message") ?? (error instanceof Error ? error.message : undefined);

  // 1. Our own RPC exceptions are authored to be user-safe, so they win first.
  if (rawMessage) {
    for (const [pattern, kind, message] of BY_RPC_MESSAGE) {
      if (pattern.test(rawMessage)) return { kind, message: scrub(message) };
    }
  }

  // 2. A safe, specific PostgREST message beats the generic code mapping, so
  //    "violates row-level security policy" stays actionable instead of being
  //    flattened into "access denied".
  const detail = rawMessage && rawMessage.includes(": ")
    ? rawMessage.slice(rawMessage.indexOf(": ") + 2)
    : rawMessage;

  if (detail && /row-level security policy/i.test(detail)) {
    return { kind: "policy", message: "Data ditolak oleh aturan akses. Periksa apakah akun kamu memiliki izin." };
  }

  // 3. Structured codes (PostgREST `code` / SQLSTATE).
  const code = readField(error, "code");
  if (code && BY_CODE[code]) return { ...BY_CODE[code] };

  if (!detail) {
    if (typeof error === "string" && error.trim()) {
      const text = error.trim();
      return LEAKY.test(text) ? GENERIC : { kind: "unknown", message: scrub(text).slice(0, 300) };
    }
    return GENERIC;
  }

  // 4. Network-level failures from the Supabase client have no code.
  if (/failed to fetch|networkerror|load failed|terminated|timeout/i.test(detail)) {
    return { kind: "unavailable", message: "Koneksi terputus. Periksa jaringan kamu lalu coba lagi.", retryable: true };
  }

  if (LEAKY.test(detail)) return GENERIC;

  if (/violates check constraint|violates foreign key|violates unique|violates not-null/i.test(detail)) {
    return { kind: "constraint", message: "Data ditolak oleh validasi database." };
  }

  if (/JWT|invalid token|token has expired|token expired/i.test(detail)) {
    return { kind: "auth", message: "Sesi kamu sudah berakhir. Silakan masuk kembali." };
  }

  if (detail.length <= 300) return { kind: "unknown", message: scrub(detail) };
  return GENERIC;
}

/**
 * Returns a message that is safe to render, and records the original error so
 * nothing is lost. `context` must never contain secrets.
 */
export function describeError(
  error: unknown,
  scope: string,
  context?: Record<string, unknown>,
): string {
  const classified = classifyError(error);
  log.error(scope, "operation failed", {
    ...context,
    kind: classified.kind,
    code: readField(error, "code"),
    details: readField(error, "details"),
    hint: readField(error, "hint"),
    cause: error instanceof Error ? error.message : String(error),
  });
  return classified.message;
}
