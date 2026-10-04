"use client";

import type { Backend } from "./types";

/**
 * The active backend, chosen once at startup like `services/app_backend.dart`:
 * Supabase for normal builds, the in-memory demo backend only when
 * `NEXT_PUBLIC_SAVEBITE_DEMO=true` is set explicitly. Errors in production are
 * never masked by falling back to demo data mid-session.
 */
let active: Backend | null = null;

export function backend(): Backend {
  if (!active) throw new Error("Backend belum dipilih. Panggil selectBackend() saat startup.");
  return active;
}

export function hasBackend(): boolean {
  return active !== null;
}

export async function selectBackend({ demo }: { demo: boolean }): Promise<Backend> {
  let selected: Backend;
  if (demo) {
    const { FakeBackend } = await import("./fake");
    selected = new FakeBackend();
  } else {
    const { SupabaseBackend } = await import("./supabase");
    selected = new SupabaseBackend();
  }
  active = selected;
  return selected;
}

/** Test seam. */
export function setBackendForTest(value: Backend | null) {
  active = value;
}
