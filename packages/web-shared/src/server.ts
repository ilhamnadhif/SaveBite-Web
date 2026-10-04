import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authCookiesSecure, publicConfig } from "./env";

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
            cookieStore.set(name, value, { ...options, ...authCookieOverrides() });
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

function authCookieOverrides() {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim();
  return {
    ...(domain ? { domain } : {}),
    path: "/",
    sameSite: "lax" as const,
    // Never `Secure` on an HTTP deployment: the browser would drop the session.
    secure: authCookiesSecure(),
  };
}
