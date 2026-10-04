"use client";

/**
 * App root: the port of `main.dart`'s `SaveBiteApp`. Shows the branded splash
 * (at least 900 ms, like the mobile app), selects the backend, restores local
 * state, then routes from the auth state — signed in to the right workspace,
 * signed out to onboarding/fork. Auth events after startup go through one
 * serial queue so `signedIn`/`signedOut` are handled exactly once.
 */
import { useEffect } from "react";
import { appState } from "../lib/appState";
import { AppNav, restoreStack } from "../lib/appNav";
import { AuthService, type AuthEvent } from "../lib/auth";
import { selectBackend } from "../lib/backend";
import { DEMO_MODE, configurationError } from "../lib/env";
import { navigator } from "../lib/navigator";
import { matchRoute } from "../lib/routes";
import { NavigatorView } from "../ui/NavigatorView";
import { OverlayHost } from "../ui/overlays";
import { NotFoundScreen } from "./shared/NotFoundScreen";
import { SplashScreen, StartupConfigurationErrorScreen } from "./onboarding/SplashScreen";

const MINIMUM_SPLASH_MS = 900;
const PAYMENT_RETURN_MARKER = "savebite_payment_return";

let started = false;

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Runs the startup sequence once per page load. */
async function startApp() {
  if (started) return;
  started = true;

  const initialUrl = currentUrl();
  navigator.attach((url) => restoreStack(url));
  await navigator.reset([{ url: initialUrl, build: () => <SplashScreen /> }], "none");
  const minimumSplash = new Promise((resolve) => setTimeout(resolve, MINIMUM_SPLASH_MS));

  const problem = configurationError();
  if (problem) {
    await minimumSplash;
    await navigator.root({ url: initialUrl, build: () => <StartupConfigurationErrorScreen message={problem} /> });
    return;
  }

  try {
    await selectBackend({ demo: DEMO_MODE });
  } catch {
    await minimumSplash;
    await navigator.root({
      url: initialUrl,
      build: () => (
        <StartupConfigurationErrorScreen message="Koneksi akun tidak dapat disiapkan. Periksa konfigurasi lalu buka ulang aplikasi." />
      ),
    });
    return;
  }
  appState.restoreLocalState();

  const pathname = window.location.pathname;
  if (pathname !== "/" && !matchRoute(pathname)) {
    await minimumSplash;
    await navigator.root({ url: initialUrl, build: () => <NotFoundScreen /> });
    return;
  }

  // Query/deep-link only wakes the app; payment status always comes from the
  // server (Get Status through the Edge Function).
  const params = new URLSearchParams(window.location.search);
  const paymentReturn = params.get(PAYMENT_RETURN_MARKER) === "1";
  const routedUrl = paymentReturn ? "/orders" : initialUrl;

  let startupRouted = false;
  let startupRouting: Promise<void> | null = null;

  const performStartupRoute = async () => {
    await minimumSplash;
    const session = AuthService.isConfigured ? await AuthService.currentSession() : null;
    if (session) {
      AppNav.setPendingDeepLink(routedUrl);
      await AppNav.handleSignedIn();
    } else {
      AppNav.routeLoggedOutAtStartup(routedUrl);
    }
    startupRouted = true;
  };
  const routeStartup = () => (startupRouting ??= performStartupRoute());

  // Serial queue for auth events (`SerialTaskQueue<AuthState>`).
  let queue: Promise<void> = Promise.resolve();
  const routeAuthEvent = async ({ event, session }: AuthEvent) => {
    if (!startupRouted && ["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED"].includes(event)) {
      await routeStartup();
      return;
    }
    if (event === "SIGNED_IN" && session) await AppNav.handleSignedIn();
    else if (event === "SIGNED_OUT") await AppNav.handleSignedOut();
  };
  AuthService.onAuthStateChange((authEvent) => {
    queue = queue.then(() => routeAuthEvent(authEvent)).catch((error: unknown) => appState.reportError(error));
  });

  // The fallback also covers the demo build and the case where the last
  // event became `TOKEN_REFRESHED` before the listener was attached. A
  // payment return lands on the orders tab, whose shell reloads the orders.
  await routeStartup();
}

export function SaveBiteApp() {
  useEffect(() => {
    void startApp().catch((error: unknown) => appState.reportError(error));
  }, []);

  return (
    <div className="sb-root" id="savebite-app">
      <NavigatorView />
      <OverlayHost />
    </div>
  );
}
