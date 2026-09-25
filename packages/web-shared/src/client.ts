"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let singleton: SupabaseClient | undefined;

export function supabaseBrowser(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase web environment is not configured.");
  if (!singleton) {
    const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim() || undefined;
    singleton = createBrowserClient(url, key, {
      cookieOptions: {
        ...(domain ? { domain } : {}),
        path: "/",
        sameSite: "lax",
        secure: window.location.protocol === "https:",
      },
    });
  }
  return singleton;
}
