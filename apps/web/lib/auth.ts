"use client";

/**
 * Supabase Auth for the web — the counterpart of `services/auth_service.dart`.
 * The web signs in with Google only.
 *
 * OAuth uses the PKCE redirect through `/auth/callback`, which exchanges the
 * code on the server so the middleware can refresh the session cookie.
 */
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { authCallbackUrl } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { DEMO_MODE, configurationError, e2eMode } from "./env";

export type AuthEvent = { event: AuthChangeEvent; session: Session | null };

export const AuthService = {
  /** True only with a usable Supabase configuration (never in demo mode). */
  get isConfigured(): boolean {
    return !DEMO_MODE && configurationError() === null;
  },

  get isDemoMode(): boolean {
    return DEMO_MODE;
  },

  async currentSession(): Promise<Session | null> {
    if (!this.isConfigured) return null;
    const { data } = await supabaseBrowser().auth.getSession();
    return data.session;
  },

  onAuthStateChange(listener: (event: AuthEvent) => void): () => void {
    if (!this.isConfigured) return () => undefined;
    const { data } = supabaseBrowser().auth.onAuthStateChange((event, session) => listener({ event, session }));
    return () => data.subscription.unsubscribe();
  },

  /** Starts Google OAuth. `next` is where `/auth/callback` sends the user. */
  async signInWithGoogle(next: string): Promise<boolean> {
    if (!this.isConfigured) return false;
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authCallbackUrl(window.location.origin, next),
        queryParams: { prompt: "select_account" },
      },
    });
    return !error;
  },

  /**
   * Email/password login for the internal E2E build only. Credentials come
   * from the form and are never stored by the app. Fails closed otherwise.
   */
  async signInWithPassword(email: string, password: string): Promise<boolean> {
    if (!e2eMode() || !this.isConfigured) return false;
    const { data, error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    return !error && data.session !== null;
  },

  async signOut(): Promise<void> {
    if (!this.isConfigured) return;
    await supabaseBrowser().auth.signOut({ scope: "local" });
  },

  /**
   * The startup session, refreshed first when the stored access token has
   * expired so profile/store bootstrap never runs on a dead token.
   */
  async restoreValidSession(): Promise<Session | null> {
    if (!this.isConfigured) return null;
    const auth = supabaseBrowser().auth;
    const { data } = await auth.getSession();
    const session = data.session;
    if (!session) return null;
    const expiresAt = (session.expires_at ?? 0) * 1000;
    if (expiresAt > Date.now()) return session;
    const refreshed = await auth.refreshSession({ refresh_token: session.refresh_token });
    if (refreshed.error) throw refreshed.error;
    return refreshed.data.session ?? (await auth.getSession()).data.session;
  },
};
