import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMigrations } from "../../../scripts/check-migrations.mjs";

/**
 * A checker that never fails is worse than no checker. Each rule below is proven
 * to fire against a deliberately vulnerable migration.
 */
function scan(sql: string, filename = "0001_test.sql") {
  const dir = mkdtempSync(join(tmpdir(), "savebite-migrations-"));
  writeFileSync(join(dir, filename), sql);
  return checkMigrations(dir);
}

const messages = (report) => report.failures.map((f) => f.message).join("\n");

describe("checkMigrations: definer function hardening", () => {
  it("flags a SECURITY DEFINER function with no pinned search_path", () => {
    const report = scan(`
      create or replace function public.danger() returns void
      language plpgsql security definer
      as $$ begin null; end $$;
    `);
    expect(report.failures).toHaveLength(1);
    expect(messages(report)).toMatch(/without a pinned search_path/);
  });

  it("flags a search_path a caller can influence", () => {
    for (const path of ["public", "$user", "pg_catalog"]) {
      const report = scan(`
        create or replace function public.danger() returns void
        language plpgsql security definer set search_path = ${path}
        as $$ begin null; end $$;
      `);
      expect(messages(report), `search_path = ${path}`).toMatch(/attacker-influenceable/);
    }
  });

  it("accepts a properly pinned search_path", () => {
    const report = scan(`
      create or replace function public.safe() returns void
      language plpgsql security definer set search_path = public, private, pg_catalog
      as $$ begin null; end $$;
      revoke all on function public.safe() from public, anon, authenticated;
    `);
    expect(report.failures).toHaveLength(0);
  });

  it("flags a revoke that forgets anon or public", () => {
    const report = scan(`
      create or replace function public.safe() returns void
      language plpgsql security definer set search_path = public, pg_catalog
      as $$ begin null; end $$;
      revoke all on function public.safe() from authenticated;
    `);
    expect(messages(report)).toMatch(/omits role "(anon|public)"/);
  });

  it("warns when a definer function is never revoked", () => {
    const report = scan(`
      create or replace function public.safe() returns void
      language plpgsql security definer set search_path = public, pg_catalog
      as $$ begin null; end $$;
    `);
    expect(report.warnings.some((w) => /executable by PUBLIC/.test(w.message))).toBe(true);
  });

  it("does not require search_path on SECURITY INVOKER functions", () => {
    const report = scan(`
      create or replace function public.plain() returns void
      language sql as $$ select 1 $$;
      revoke all on function public.plain() from public, anon;
    `);
    expect(report.failures).toHaveLength(0);
  });
});

describe("checkMigrations: secret table exposure", () => {
  const SECRET_TABLE = `
    create table if not exists private.pickup_codes (
      order_id uuid primary key,
      code_hash bytea not null
    );
  `;

  it("flags a credential table the browser can read", () => {
    const report = scan(SECRET_TABLE);
    expect(messages(report)).toMatch(/revoke all .* from anon, authenticated|revoke all/);
  });

  it("flags a revoke that omits authenticated", () => {
    const report = scan(`
      ${SECRET_TABLE}
      alter table private.pickup_codes enable row level security;
      revoke all on table private.pickup_codes from public, anon, service_role;
    `);
    expect(messages(report)).toMatch(/omits role "authenticated"/);
  });

  it("flags a credential table without row level security", () => {
    const report = scan(`
      ${SECRET_TABLE}
      revoke all on table private.pickup_codes from public, anon, authenticated, service_role;
    `);
    expect(messages(report)).toMatch(/does not enable row level security/);
  });

  it("passes a fully protected credential table", () => {
    const report = scan(`
      ${SECRET_TABLE}
      alter table private.pickup_codes enable row level security;
      revoke all on table private.pickup_codes from public, anon, authenticated, service_role;
    `);
    expect(report.failures).toHaveLength(0);
  });

  it("does not flag ordinary tables that hold no credential", () => {
    const report = scan(`
      create table if not exists public.bags (
        id uuid primary key
      );
    `);
    expect(report.failures).toHaveLength(0);
  });

  it("warns when a table-creating migration is not transactional", () => {
    const report = scan(`
      create table if not exists public.bags (
        id uuid primary key
      );
    `);
    expect(report.warnings.some((w) => /begin\/commit/.test(w.message))).toBe(true);
  });
});

describe("checkMigrations: committed credentials", () => {
  it("flags a hardcoded Supabase secret key", () => {
    const report = scan(`
      begin;
      select 'sb_secret_abcdefghijklmnopqrstuvwx';
      commit;
    `);
    expect(messages(report)).toMatch(/hardcoded credential/);
  });

  it("does not flag the word service_role used in a revoke list", () => {
    const report = scan(`
      begin;
      create table if not exists public.bags (id uuid primary key);
      revoke all on table public.bags from anon, service_role;
      commit;
    `);
    expect(messages(report)).not.toMatch(/hardcoded credential/);
  });
});

describe("checkMigrations: the real migration", () => {
  it("passes the checked-in 0022 migration", () => {
    // Vite rewrites import.meta.url to an /@fs/ path, so resolve from cwd
    // (the package root) instead.
    const report = checkMigrations(join(process.cwd(), "..", "..", "supabase", "migrations"));
    expect(report.failures).toEqual([]);
    expect(report.counts.migrations).toBeGreaterThan(0);
    expect(report.counts.functions).toBeGreaterThan(0);
    expect(report.counts.tables).toBeGreaterThan(0);
  });

  it("throws when the directory has no migrations", () => {
    const dir = mkdtempSync(join(tmpdir(), "savebite-empty-"));
    expect(() => checkMigrations(dir)).toThrow(/no .sql files/);
  });
});
