/**
 * The web-relevant parts of `test/env_test.dart` for `lib/env.ts`
 * (`configurationError`, `e2eMode`, `midtransSandbox`, `DEMO_MODE`). The
 * Flutter dotenv/asset parsing has no web counterpart (Next.js reads env).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "@savebite/web-shared";

const ORIGINAL_ENV = { ...process.env };

const VALID: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_example",
  NEXT_PUBLIC_AUTH_CALLBACK_URL: "https://app.savebite.com/auth/callback",
  NEXT_PUBLIC_MIDTRANS_CLIENT_KEY: "Mid-client-publicExample123",
  NEXT_PUBLIC_MIDTRANS_ENVIRONMENT: "sandbox",
  NEXT_PUBLIC_SAVEBITE_E2E: undefined,
  NEXT_PUBLIC_SAVEBITE_DEMO: undefined,
};

/** `DEMO_MODE`/`e2eMode` are read at import, so each case re-imports the module. */
async function loadEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries({ ...VALID, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigCache();
  vi.resetModules();
  return import("../lib/env");
}

function jwtWithRole(role: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ role })}.signature`;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetConfigCache();
});

describe("configurationError", () => {
  it("a complete public sandbox profile is usable", async () => {
    const env = await loadEnv({});
    expect(env.configurationError()).toBeNull();
    expect(env.midtransSandbox()).toBe(true);
    expect(env.e2eMode()).toBe(false);
    expect(env.DEMO_MODE).toBe(false);
  });

  it("konfigurasi tidak lengkap gagal tertutup, bukan mode demo", async () => {
    const env = await loadEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined });
    expect(env.DEMO_MODE).toBe(false);
    expect(env.configurationError()).not.toBeNull();
  });

  it("the incomplete-configuration message is the Flutter copy", async () => {
    const env = await loadEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined });
    expect(env.configurationError()).toContain("belum lengkap");
  });

  // Flutter refuses a service-role JWT or an `sb_secret_` key as the client
  // key; a NEXT_PUBLIC_ secret would otherwise ship in the browser bundle.
  it("service-role JWT ditolak dari konfigurasi client", async () => {
    const env = await loadEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwtWithRole("service_role") });
    expect(env.configurationError()).toContain("tidak boleh");
  });

  it("an sb_secret_ key is refused like in Flutter", async () => {
    const env = await loadEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_example" });
    expect(env.configurationError()).toContain("tidak boleh");
  });

  it("an anon JWT is a valid client key", async () => {
    const env = await loadEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwtWithRole("anon") });
    expect(env.configurationError()).toBeNull();
  });

  it("Midtrans Server Key ditolak dari konfigurasi client", async () => {
    const env = await loadEnv({ NEXT_PUBLIC_MIDTRANS_CLIENT_KEY: "Mid-server-secretExample123" });
    expect(env.configurationError()).toBe("MIDTRANS_CLIENT_KEY tidak valid. Gunakan Client Key publik, bukan Server Key.");
  });

  it("a profile without a Midtrans client key is not usable", async () => {
    const env = await loadEnv({ NEXT_PUBLIC_MIDTRANS_CLIENT_KEY: undefined });
    expect(env.configurationError()).toContain("MIDTRANS_CLIENT_KEY");
    const short = await loadEnv({ NEXT_PUBLIC_MIDTRANS_CLIENT_KEY: "Mid-client-short" });
    expect(short.configurationError()).toContain("MIDTRANS_CLIENT_KEY");
  });

  it("alat E2E gagal tertutup di luar profile sandbox", async () => {
    const production = await loadEnv({ NEXT_PUBLIC_MIDTRANS_ENVIRONMENT: "production", NEXT_PUBLIC_SAVEBITE_E2E: "true" });
    expect(production.configurationError()).toBe("SAVEBITE_E2E hanya boleh digunakan dengan profile sandbox.");
    expect(production.e2eMode()).toBe(false);

    const plainProduction = await loadEnv({ NEXT_PUBLIC_MIDTRANS_ENVIRONMENT: "production" });
    expect(plainProduction.configurationError()).toBeNull();
    expect(plainProduction.midtransSandbox()).toBe(false);

    const sandbox = await loadEnv({ NEXT_PUBLIC_SAVEBITE_E2E: "true" });
    expect(sandbox.configurationError()).toBeNull();
    expect(sandbox.e2eMode()).toBe(true);
  });

  // Not ported on purpose: Flutter release builds refuse the sandbox profile
  // unless SAVEBITE_ALLOW_SANDBOX_RELEASE=true. Every deployed web build is a
  // production build and the current deployments run on sandbox, so this is a
  // deployment-policy decision rather than app behaviour.
  it.skip("release sandbox memerlukan izin staging eksplisit", async () => {
    const env = await loadEnv({ NODE_ENV: "production" });
    expect(env.configurationError()).toContain("izin staging eksplisit");
  });

  it("demo mode is explicit and never needs the remote configuration", async () => {
    const demo = await loadEnv({ NEXT_PUBLIC_SAVEBITE_DEMO: "true", NEXT_PUBLIC_SUPABASE_URL: undefined });
    expect(demo.DEMO_MODE).toBe(true);
    expect(demo.configurationError()).toBeNull();

    const notDemo = await loadEnv({ NEXT_PUBLIC_SAVEBITE_DEMO: "1", NEXT_PUBLIC_SUPABASE_URL: undefined });
    expect(notDemo.DEMO_MODE).toBe(false);
    expect(notDemo.configurationError()).not.toBeNull();
  });
});
