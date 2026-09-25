"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "./client";

type AuthState = { session: Session | null; user: User | null; loading: boolean; signOut: () => Promise<void> };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) { setSession(data.session); setLoading(false); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  const value = useMemo<AuthState>(() => ({
    session, user: session?.user ?? null, loading,
    signOut: async () => { await supabaseBrowser().auth.signOut(); },
  }), [session, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function AuthGate({ children, merchant = false }: { children: ReactNode; merchant?: boolean }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [storeReady, setStoreReady] = useState(!merchant);
  const [hasStore, setHasStore] = useState(false);
  useEffect(() => {
    if (!merchant || !user) { setStoreReady(true); return; }
    let active = true;
    void supabaseBrowser().rpc("get_my_merchant").then(({ data, error }) => {
      if (!active) return;
      setHasStore(!error && !!data);
      setStoreReady(true);
    });
    return () => { active = false; };
  }, [merchant, user]);
  useEffect(() => {
    if (!merchant) return;
    if (!loading && !user) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?role=merchant&next=${encodeURIComponent(next)}`);
    }
    else if (merchant && user && storeReady && !hasStore && window.location.pathname !== "/merchant/setup") router.replace("/merchant/setup");
  }, [loading, user, merchant, storeReady, hasStore, router]);
  if (!merchant) return <>{children}</>;
  if (loading || (merchant && user && !storeReady)) return <div className="loading-screen"><span className="spinner" />Memuat sesi…</div>;
  if (!user) return <div className="loading-screen">Mengarahkan ke halaman masuk…</div>;
  if (merchant && !hasStore && typeof window !== "undefined" && window.location.pathname !== "/merchant/setup") return <div className="loading-screen">Menyiapkan toko…</div>;
  return <>{children}</>;
}
