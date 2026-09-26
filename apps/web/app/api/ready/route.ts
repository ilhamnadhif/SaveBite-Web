import { NextResponse } from "next/server";
import { configStatus, log } from "@savebite/web-shared";
import { supabaseServer } from "@savebite/web-shared/server";

export const dynamic = "force-dynamic";

/**
 * Readiness. Reports ready only when the process is configured *and* the one
 * hard dependency -- Supabase PostgREST -- actually answers.
 *
 * A TCP/HTTP failure is treated as a transient outage and retried once with a
 * short backoff, because a single dropped packet during a rolling deploy should
 * not mark a healthy instance unready. The worst case is bounded at roughly
 * 4.2s so the endpoint stays usable as a container health check; credentials and
 * rows are never echoed, only the error class is.
 */
const PROBE_ATTEMPTS = 2;
const PROBE_TIMEOUT_MS = 2000;
const BACKOFF_MS = 200;

async function probeSupabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const supabase = await supabaseServer();
      // `head: true` performs no row transfer, so the probe stays cheap.
      const { error } = await supabase.from("available_bags").select("*", { head: true, count: "exact" }).abortSignal(controller.signal);
      clearTimeout(timer);
      if (!error) return { ok: true, latencyMs: Date.now() - startedAt };
      if (attempt === PROBE_ATTEMPTS) {
        return { ok: false, latencyMs: Date.now() - startedAt, error: error.message };
      }
    } catch (error) {
      clearTimeout(timer);
      if (attempt === PROBE_ATTEMPTS) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
  }

  return { ok: false, latencyMs: Date.now() - startedAt, error: "probe exhausted" };
}

export async function GET() {
  const config = configStatus();
  const database = await probeSupabase();

  const ready = config.ok && database.ok;
  const body = {
    status: ready ? "ready" : "not_ready",
    checks: {
      config: { ok: config.ok, missing: config.missing, invalid: config.invalid },
      database: { ok: database.ok, latencyMs: database.latencyMs, error: database.error },
      midtrans: { configured: config.midtransConfigured },
      sharedCookieDomain: config.cookieDomainShared,
    },
    time: new Date().toISOString(),
  };

  if (!ready) {
    log.error("readiness", "instance is not ready", {
      configMissing: config.missing,
      configInvalid: config.invalid,
      databaseError: database.error,
    });
  }

  return NextResponse.json(body, {
    // 503 is what makes Docker / a load balancer hold traffic back.
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
