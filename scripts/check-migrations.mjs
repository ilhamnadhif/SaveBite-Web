#!/usr/bin/env node
/**
 * Static safety checks for the SQL in supabase/migrations.
 *
 * These are the invariants a reviewer would otherwise have to re-verify on every
 * PR, and that a reviewer would miss under time pressure:
 *
 *   1. every `security definer` function pins `search_path` (otherwise a caller
 *      can shadow a function and execute code as the definer);
 *   2. definer functions are not executable by `anon`/`public`;
 *   3. tables holding a low-entropy credential are neither readable nor
 *      writable by the browser roles;
 *   4. migrations that create tables are transactional and idempotent;
 *   5. no migration hardcodes a credential.
 *
 * This is a lint, not a Postgres parser. It only reports on constructs it can
 * actually see, and `test/check-migrations.test.mjs` proves each rule fires.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase",
  "migrations",
);

/** Roles that must never be able to call a definer function. */
const UNTRUSTED_ROLES = ["anon", "public"];

/** Roles that must never be able to read a secret-bearing table. */
const CLIENT_ROLES = ["anon", "authenticated"];

/** Table name fragments that indicate a credential, hash, or attempt ledger. */
const SECRET_TABLE_HINTS = [
  "code",
  "token",
  "secret",
  "credential",
  "password",
  "hash",
  "attempt",
  "nonce",
  "otp",
];

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Strips comments and single-quoted literals so keywords are not matched in prose. */
function stripNoise(sql) {
  return stripComments(sql).replace(/'(?:''|[^'])*'/g, "''");
}

/** Comments only: dollar-quoted bodies must survive so functions stay parseable. */
function stripComments(sql) {
  return sql
    .replace(/--[^\n]*/g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Every `create [or replace] function ... $$ body $$` block. */
function findFunctions(sql) {
  const functions = [];
  const re =
    /create\s+(or\s+replace\s+)?function\s+([^\s(]+)\s*\(([^)]*)\)([\s\S]*?)\$\$\s*([\s\S]*?)\$\$\s*;/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const [, , name, args, header, body] = match;
    functions.push({
      name,
      args: args.replace(/\s+/g, " ").trim(),
      header,
      body,
      startLine: sql.slice(0, match.index).split("\n").length,
      isDefiner: /security\s+definer/i.test(header),
      searchPath: (header.match(/set\s+search_path\s*=\s*([^\s;]+)/i) || [])[1],
    });
  }
  return functions;
}

/** Every `create table` statement. */
function findTables(sql) {
  const tables = [];
  const re = /create\s+table\s+(if\s+not\s+exists\s+)?([\w."]+)\s*\(([\s\S]*?)\);/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    tables.push({
      name: match[2].replace(/"/g, "").toLowerCase(),
      ifNotExists: Boolean(match[1]),
      columns: match[3],
      startLine: sql.slice(0, match.index).split("\n").length,
    });
  }
  return tables;
}

/**
 * Scans a migrations directory.
 * @returns {{failures: Array, warnings: Array, counts: object}}
 */
export function checkMigrations(directory) {
  const failures = [];
  const warnings = [];
  const fail = (file, line, message) => failures.push({ file, line, message });
  const warn = (file, line, message) => warnings.push({ file, line, message });

  const migrationFiles = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (!migrationFiles.length) {
    throw new Error(`no .sql files found in ${directory}`);
  }

  let functionsChecked = 0;
  let tablesChecked = 0;

  for (const name of migrationFiles) {
    const raw = readFileSync(join(directory, name), "utf8");
    const sql = stripNoise(raw);
    // Function bodies are parsed from a variant that keeps dollar quoting.
    const parseable = stripComments(raw);

    // --- rules 1 & 2: definer function hardening -------------------------
    for (const fn of findFunctions(parseable)) {
      functionsChecked += 1;

      if (fn.isDefiner) {
        if (!fn.searchPath) {
          fail(
            name,
            fn.startLine,
            `function ${fn.name} is SECURITY DEFINER without a pinned search_path; a caller could shadow a function and run code as the definer`,
          );
        } else if (/^\s*(public|pg_catalog)\s*$/i.test(fn.searchPath) || /\$user/i.test(fn.searchPath)) {
          fail(
            name,
            fn.startLine,
            `function ${fn.name} sets search_path to "${fn.searchPath}", which is attacker-influenceable`,
          );
        }
      }

      const revoke = parseable.match(
        new RegExp(
          `revoke[^;]*on\\s+function\\s+${escapeRe(fn.name)}\\s*\\([\\s\\S]*?;`,
          "i",
        ),
      );
      if (!revoke) {
        warn(
          name,
          fn.startLine,
          `function ${fn.name} has no explicit revoke; with default privileges it stays executable by PUBLIC`,
        );
      } else {
        for (const role of UNTRUSTED_ROLES) {
          if (!new RegExp(`\\b${role}\\b`, "i").test(revoke[0])) {
            fail(
              name,
              fn.startLine,
              `revoke on ${fn.name} omits role "${role}"; the function remains callable by that role`,
            );
          }
        }
      }
    }

    // --- rule 3: secret-bearing tables are not client-readable -----------
    for (const table of findTables(sql)) {
      tablesChecked += 1;
      if (!SECRET_TABLE_HINTS.some((hint) => table.name.includes(hint))) continue;

      const revoke = sql.match(
        new RegExp(
          `revoke\\s+all\\s+on\\s+table\\s+${escapeRe(table.name)}[\\s\\S]*?;`,
          "i",
        ),
      );
      if (!revoke) {
        fail(
          name,
          table.startLine,
          `table ${table.name} looks like it holds a credential or hash but has no "revoke all ... from anon, authenticated"`,
        );
      } else {
        for (const role of CLIENT_ROLES) {
          if (!new RegExp(`\\b${role}\\b`, "i").test(revoke[0])) {
            fail(
              name,
              table.startLine,
              `revoke on ${table.name} omits role "${role}"; the browser can read this table`,
            );
          }
        }
      }

      if (!/enable\s+row\s+level\s+security/i.test(sql)) {
        fail(name, table.startLine, `table ${table.name} does not enable row level security`);
      }
    }

    // --- rule 4: schema changes are transactional and idempotent --------
    if (findTables(sql).length && !/^\s*begin\s*;/im.test(sql)) {
      warn(
        name,
        1,
        "creates tables but is not wrapped in begin/commit, so a failure leaves a partial schema",
      );
    }

    // --- rule 5: no committed credentials -------------------------------
    // `service_role` on its own is not a secret: it legitimately appears in
    // revoke/grant lists. Match real token shapes only.
    if (/(sb_secret_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/.test(raw)) {
      fail(name, 1, "appears to contain a hardcoded credential");
    }
  }

  return {
    failures,
    warnings,
    counts: { migrations: migrationFiles.length, functions: functionsChecked, tables: tablesChecked },
  };
}

/** CLI entry point. */
function main() {
  const directory = process.argv[2] || DEFAULT_MIGRATIONS_DIR;
  let report;
  try {
    report = checkMigrations(directory);
  } catch (error) {
    console.error(`check:migrations could not read ${directory}: ${error.message}`);
    process.exit(1);
  }

  for (const item of report.warnings) console.warn(`  warn  ${item.file}:${item.line}  ${item.message}`);
  for (const item of report.failures) console.error(`  FAIL  ${item.file}:${item.line}  ${item.message}`);

  const { migrations, functions, tables } = report.counts;
  console.log(
    `check:migrations inspected ${migrations} migration(s), ` +
      `${functions} function(s), ${tables} table(s); ` +
      `${report.failures.length} failure(s), ${report.warnings.length} warning(s).`,
  );
  process.exit(report.failures.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
