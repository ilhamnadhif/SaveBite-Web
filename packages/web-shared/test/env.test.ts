import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, authCookieOptions, configStatus, publicConfig, resetConfigCache } from "../src/env";

const ORIGINAL = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigCache();
}

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
  NEXT_PUBLIC_AUTH_CALLBACK_URL: "http://localhost:3000/auth/callback",
  NEXT_PUBLIC_COOKIE_DOMAIN: "",
  NEXT_PUBLIC_MIDTRANS_CLIENT_KEY: "Mid-client-test",
  NEXT_PUBLIC_MIDTRANS_ENVIRONMENT: "sandbox",
};

beforeEach(() => setEnv(VALID));
afterEach(() => {
  process.env = { ...ORIGINAL };
  resetConfigCache();
});

describe("publicConfig", () => {
  it("returns a validated config for well-formed env", () => {
    const config = publicConfig();
    expect(config.supabaseUrl).toBe("https://project.supabase.co");
    expect(config.midtransEnvironment).toBe("sandbox");
    expect(config.cookieDomain).toBeUndefined();
  });

  it("trims whitespace so a stray newline in a secret store does not break it", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: "  https://project.supabase.co\n" });
    expect(publicConfig().supabaseUrl).toBe("https://project.supabase.co");
  });

  it.each([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_AUTH_CALLBACK_URL",
  ])("fails fast with an actionable message when %s is missing", (name) => {
    setEnv({ [name]: undefined });
    expect(() => publicConfig()).toThrow(ConfigError);
    expect(() => publicConfig()).toThrow(new RegExp(name));
  });

  it("rejects a malformed Supabase URL instead of deferring the failure", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" });
    expect(() => publicConfig()).toThrow(/absolute https:\/\/ URL/);
  });

  it("rejects an unrecognised Midtrans environment", () => {
    setEnv({ NEXT_PUBLIC_MIDTRANS_ENVIRONMENT: "staging" });
    expect(() => publicConfig()).toThrow(/sandbox.*production/);
  });

  it("defaults Midtrans to sandbox when unset", () => {
    setEnv({ NEXT_PUBLIC_MIDTRANS_ENVIRONMENT: undefined });
    expect(publicConfig().midtransEnvironment).toBe("sandbox");
  });

  it("accepts production", () => {
    setEnv({ NEXT_PUBLIC_MIDTRANS_ENVIRONMENT: "production" });
    expect(publicConfig().midtransEnvironment).toBe("production");
  });

  it("treats a blank cookie domain as localhost (host-only cookies)", () => {
    setEnv({ NEXT_PUBLIC_COOKIE_DOMAIN: "   " });
    expect(publicConfig().cookieDomain).toBeUndefined();
  });

  it("accepts a leading-dot cookie domain for cross-subdomain sessions", () => {
    setEnv({ NEXT_PUBLIC_COOKIE_DOMAIN: ".savebite.com" });
    expect(publicConfig().cookieDomain).toBe(".savebite.com");
  });

  it("rejects a cookie domain that is not a bare domain", () => {
    setEnv({ NEXT_PUBLIC_COOKIE_DOMAIN: "https://savebite.com/path" });
    expect(() => publicConfig()).toThrow(/bare domain/);
  });

  it("memoises, so the hot path does not re-parse on every call", () => {
    const first = publicConfig();
    // Bypass setEnv: it resets the cache, which is the thing under test.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://changed.supabase.co";
    expect(publicConfig()).toBe(first);
    resetConfigCache();
    expect(publicConfig().supabaseUrl).toBe("https://changed.supabase.co");
  });
});

describe("authCookieOptions", () => {
  it("omits the domain key entirely on localhost", () => {
    setEnv({ NEXT_PUBLIC_COOKIE_DOMAIN: "" });
    const options = authCookieOptions();
    expect(options).not.toHaveProperty("domain");
    expect(options.path).toBe("/");
    expect(options.sameSite).toBe("lax");
  });

  it("never uses SameSite=Strict, which would break the OAuth round trip", () => {
    expect(authCookieOptions().sameSite).not.toBe("strict");
  });
});

describe("configStatus", () => {
  it("reports ok when everything required is present", () => {
    expect(configStatus().ok).toBe(true);
    expect(configStatus().missing).toEqual([]);
  });

  it("lists missing variables without echoing any value", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined });
    const status = configStatus();
    expect(status.ok).toBe(false);
    expect(status.missing).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(JSON.stringify(status)).not.toContain("sb_publishable");
  });

  it("separates invalid values from missing ones", () => {
    setEnv({ NEXT_PUBLIC_MIDTRANS_ENVIRONMENT: "prod" });
    const status = configStatus();
    expect(status.invalid).toContain("NEXT_PUBLIC_MIDTRANS_ENVIRONMENT");
    expect(status.missing).toEqual([]);
  });

  it("does not throw when misconfigured, so /ready can still report", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: "nope" });
    expect(() => configStatus()).not.toThrow();
    expect(configStatus().invalid).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });
});
