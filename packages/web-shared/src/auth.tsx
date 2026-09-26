"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "./client";
import { describeError } from "./errors";
import { log } from "./log";
import { safeNextPath } from "./redirect";

type AuthState = { session: Session | null; user: User | null; loading: boolean; signOut: () => Promise<void> };
/** Exported so tests can supply a session without standing up Supabase. */
export const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // The client is created lazily: a misconfigured env should surface as a
    // render error in the consuming component, not as a module-load crash.
    let supabase: ReturnType<typeof supabaseBrowser>;
    try {
      supabase = supabaseBrowser();
    } catch (error) {
      log.error("auth", "browser client unavailable", { error });
      if (active) setLoading(false);
      return;
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) log.warn("auth", "getSession failed", { error });
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "SIGNED_OUT") {
        log.debug("auth", "session changed", { event });
      }
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabaseBrowser().auth.signOut();
  }, []);

  const value = useMemo<AuthState>(
    () => ({ session, user: session?.user ?? null, loading, signOut }),
    [session, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

type StoreLookup = "loading" | "error" | "done";

/**
 * Gates the merchant workspace.
 *
 * Consumer pages are intentionally public: browsing the catalogue does not
 * require an account, and all data access is still constrained by Supabase RLS.
 *
 * The merchant workspace requires both a session and a store. Two correctness
 * details matter here:
 *
 *  - A failed `get_my_merchant` RPC must NOT be treated as "no store". The old
 *    code did, so a transient database error bounced the merchant to
 *    `/merchant/setup`, where the insert then failed with a duplicate-key error
 *    and the operator had no way to tell a real bug from a network blip.
 *  - The deep link is preserved through the login round trip, and sanitised so
 *    `?next=` can never become an off-site redirect.
 */
export function AuthGate({ children, merchant = false }: { children: ReactNode; merchant?: boolean }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // `lookup` and `hasStore` are tracked separately so a failed lookup can never
  // be mistaken for "this account has no store".
  const [lookup, setLookup] = useState<StoreLookup>(merchant ? "loading" : "done");
  const [hasStore, setHasStore] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!merchant || !user) {
      setLookup("done");
      return;
    }

    let active = true;

    const onResult = (data: unknown, error: unknown) => {
      if (!active) return;
      if (error) {
        setLookup("error");
        setStoreError(describeError(error, "merchant.storeLookup", { userId: user.id }));
        return;
      }
      setHasStore(Boolean(data));
      setLookup("done");
    };

    setLookup("loading");
    setStoreError(null);

    // `Promise.resolve` normalises the PostgREST thenable, which is typed as
    // PromiseLike and therefore has no `.catch`.
    void Promise.resolve(supabaseBrowser().rpc("get_my_merchant"))
      .then(({ data, error }) => onResult(data, error))
      .catch((error: unknown) => onResult(null, error));

    return () => {
      active = false;
    };
  }, [merchant, user, retryNonce]);

  const onSetup = merchant && pathname === "/merchant/setup";

  useEffect(() => {
    if (!merchant || loading) return;

    if (!user) {
      // The pathname comes from the router so it matches what is rendered; the
      // search string is read live because it is not part of usePathname().
      const search = typeof window !== "undefined" ? window.location.search : "";
      const target = safeNextPath(`${pathname}${search}`, {
        fallback: "",
        requirePrefix: "/merchant",
      });
      router.replace(`/login?role=merchant${target ? `&next=${encodeURIComponent(target)}` : ""}`);
      return;
    }

    if (lookup === "done" && !hasStore && !onSetup) {
      router.replace("/merchant/setup");
    }

    // Conversely, a merchant who already owns a store must not be able to sit
    // on the setup form and create a second one.
    if (lookup === "done" && hasStore && onSetup) {
      router.replace("/merchant");
    }
  }, [merchant, loading, user, lookup, hasStore, onSetup, pathname, router]);

  if (!merchant) return <>{children}</>;

  if (loading || (user && lookup === "loading")) {
    return (
      <div className="loading-screen" aria-busy="true" aria-live="polite">
        <span className="spinner" />Memuat sesi…
      </div>
    );
  }

  if (!user) return <div className="loading-screen">Mengarahkan ke halaman masuk…</div>;

  if (lookup === "error") {
    return (
      <div className="loading-screen">
        <div className="alert alert-error" role="alert">
          {storeError ?? "Toko tidak dapat dimuat."}{" "}
          <button className="text-link" onClick={() => setRetryNonce((value) => value + 1)}>
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  if (!hasStore && !onSetup) return <div className="loading-screen">Menyiapkan toko…</div>;

  if (hasStore && onSetup) return <div className="loading-screen">Membuka dashboard toko…</div>;

  return <>{children}</>;
}
