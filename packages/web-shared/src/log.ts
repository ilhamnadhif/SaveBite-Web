/**
 * Minimal structured logging.
 *
 * Requirements this satisfies:
 *  - Server logs are single-line JSON so a VPS journald / Docker log driver can
 *    parse them and operators can filter by `scope` or `requestId`.
 *  - Secrets never reach the log. Values are redacted by key *and* scrubbed
 *    for long opaque tokens that appear inside free-form messages.
 *  - No logging dependency is introduced; the surface is intentionally tiny.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY = /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|anon[-_]?key|credential|session|bearer)/i;

/** JWTs, Supabase refresh tokens and long hex/base64 blobs. */
const OPAQUE_TOKEN = /\b(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{40,})\b/g;

const REDACTED = "[redacted]";

export function redact(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(OPAQUE_TOKEN, REDACTED);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name, message: scrub(value.message) };
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, "", depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v, k, depth + 1);
    }
    return out;
  }
  return String(value);
}

function scrub(message: string): string {
  return message.replace(OPAQUE_TOKEN, REDACTED).slice(0, 2000);
}

const isBrowser = typeof window !== "undefined";
const threshold: number = LEVEL_ORDER[(process.env.LOG_LEVEL as LogLevel) ?? "info"] ?? LEVEL_ORDER.info;

function emit(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < threshold) return;
  const payload = {
    level,
    scope,
    message: scrub(message),
    time: new Date().toISOString(),
    ...(fields ? (redact(fields) as LogFields) : {}),
  };

  if (isBrowser) {
    // Keep the browser console readable; JSON is for the server.
    const args: unknown[] = [`[${scope}] ${message}`];
    if (fields) args.push(payload);
    if (level === "error") console.error(...args);
    else if (level === "warn") console.warn(...args);
    else if (level === "info" || level === "debug") console.info(...args);
    return;
  }

  const line = JSON.stringify(payload);
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  debug: (scope: string, message: string, fields?: LogFields) => emit("debug", scope, message, fields),
  info: (scope: string, message: string, fields?: LogFields) => emit("info", scope, message, fields),
  warn: (scope: string, message: string, fields?: LogFields) => emit("warn", scope, message, fields),
  error: (scope: string, message: string, fields?: LogFields) => emit("error", scope, message, fields),
};

/**
 * Extracts a correlation id from an inbound request so client-reported errors
 * can be tied to a server log line.
 */
export function requestIdFrom(headers: Headers | undefined): string | undefined {
  if (!headers) return undefined;
  const value = headers.get("x-request-id") ?? headers.get("x-correlation-id");
  return value ? value.slice(0, 64) : undefined;
}
