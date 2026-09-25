import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase web environment is not configured.");
  const cookieStore = await cookies();
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim() || undefined;
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              ...(domain ? { domain } : {}),
              path: "/",
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            }),
          );
        } catch {
          // Server components cannot write cookies; middleware performs refreshes.
        }
      },
    },
  });
}
