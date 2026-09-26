"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authCookieOptions, publicConfig } from "./env";

let singleton: SupabaseClient | undefined;

export function supabaseBrowser(): SupabaseClient {
  if (singleton) return singleton;
  const { supabaseUrl, supabaseAnonKey } = publicConfig();
  singleton = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: authCookieOptions(),
  });
  return singleton;
}

/** Test seam. */
export function resetBrowserClient(): void {
  singleton = undefined;
}
