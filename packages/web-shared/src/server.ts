import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicConfig } from "./env";

export async function supabaseServer() {
  const { supabaseUrl, supabaseAnonKey } = publicConfig();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            // Spread the Supabase-provided options first so `maxAge`,
            // `httpOnly`, etc. survive, then apply our own hard requirements.
            cookieStore.set(name, value, { ...options, ...authCookieOverrides(options.secure) });
          }
        } catch {
          // Server Components cannot mutate cookies. The middleware performs
          // every session refresh; swallowing here is intentional and matches
          // the documented @supabase/ssr pattern.
        }
      },
    },
  });
}

function authCookieOverrides(supabaseSecure: boolean | undefined) {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim();
  return {
    ...(domain ? { domain } : {}),
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" || supabaseSecure === true,
  };
}
