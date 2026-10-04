/**
 * TypeScript port of the Flutter web bridge (`web/snap_bridge.js`).
 *
 * Loads Midtrans Snap.js once per client key and environment, then opens the
 * official in-page popup. Provider payloads are deliberately discarded: the
 * caller only receives a hint and asks the authenticated backend for the
 * authoritative payment state.
 */

/** What the caller is told: a status hint, or that the popup was closed. */
export type SnapResultKind = "status" | "closed";

type SnapCallbacks = {
  onSuccess: () => void;
  onPending: () => void;
  onError: () => void;
  onClose: () => void;
};

/** The subset of Midtrans' `window.snap` the bridge uses. */
type Snap = {
  pay: (token: string, options: SnapCallbacks) => void;
  hide?: () => void;
};

type ActiveSession = {
  sessionId: string;
  onResult: (kind: SnapResultKind) => void;
  notified: boolean;
};

const SCRIPTS = Object.freeze({
  sandbox: "https://app.sandbox.midtrans.com/snap/snap.js",
  production: "https://app.midtrans.com/snap/snap.js",
});
const CLIENT_KEY_PATTERN = /^Mid-client-[A-Za-z0-9_-]{8,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;
const SNAP_LOAD_TIMEOUT_MS = 20_000;

let scriptPromise: Promise<Snap> | null = null;
let scriptIdentity: string | null = null;
let active: ActiveSession | null = null;

/** `window.snap`, read without widening the global `Window` type. */
function currentSnap(): Partial<Snap> | undefined {
  return (window as unknown as { snap?: Partial<Snap> }).snap;
}

function isSnap(value: Partial<Snap> | undefined): value is Snap {
  return value !== undefined && value !== null && typeof value.pay === "function";
}

function scriptFor(environment: string): string | undefined {
  if (environment === "sandbox") return SCRIPTS.sandbox;
  if (environment === "production") return SCRIPTS.production;
  return undefined;
}

function hideActive() {
  try {
    const snap = currentSnap();
    if (snap && typeof snap.hide === "function") snap.hide();
  } catch {
    // Closing an already-closed overlay is harmless.
  }
  active = null;
}

function loadSnap(clientKey: string, environment: string): Promise<Snap> {
  const src = scriptFor(environment);
  if (!src || !CLIENT_KEY_PATTERN.test(clientKey)) {
    return Promise.reject(new Error("Invalid Midtrans client config"));
  }
  const identity = `${src}|${clientKey}`;
  if (scriptPromise && scriptIdentity === identity) return scriptPromise;
  if (scriptPromise && scriptIdentity !== identity) {
    return Promise.reject(new Error("Midtrans environment cannot change"));
  }

  scriptIdentity = identity;
  const candidate = new Promise<Snap>((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      script.onload = null;
      script.onerror = null;
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      reject(error);
    };

    const succeed = (value: Snap) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    script.src = src;
    script.async = true;
    script.setAttribute("data-client-key", clientKey);
    script.referrerPolicy = "no-referrer";
    script.onload = () => {
      const snap = currentSnap();
      if (isSnap(snap)) succeed(snap);
      else fail(new Error("Snap.js did not initialize"));
    };
    script.onerror = () => {
      fail(new Error("Snap.js failed to load"));
    };
    timeoutId = setTimeout(() => {
      fail(new Error("Snap.js load timed out"));
    }, SNAP_LOAD_TIMEOUT_MS);
    try {
      document.head.appendChild(script);
    } catch (error) {
      fail(error);
    }
  });
  scriptPromise = candidate.catch((error: unknown) => {
    // A transient network failure must remain retryable from the in-app
    // reload control; never pin a rejected Promise for the page lifetime.
    if (scriptIdentity === identity) {
      scriptPromise = null;
      scriptIdentity = null;
    }
    throw error;
  });
  return scriptPromise;
}

/**
 * Opens the Snap popup for `token`. `onResult` fires at most once per
 * session, and never after the session was hidden or replaced.
 */
export async function pay(
  token: string,
  clientKey: string,
  environment: string,
  sessionId: string,
  onResult: (kind: SnapResultKind) => void,
): Promise<void> {
  if (!TOKEN_PATTERN.test(token) || typeof onResult !== "function") {
    throw new Error("Invalid Snap checkout session");
  }
  hideActive();
  const current: ActiveSession = { sessionId, onResult, notified: false };
  active = current;
  const snap = await loadSnap(clientKey, environment);
  if (active !== current) return;

  const notify = (kind: SnapResultKind) => {
    if (active !== current || current.notified) return;
    current.notified = true;
    // Provider payloads are deliberately discarded. The screen only receives
    // a hint and asks the authenticated backend for the authoritative state.
    current.onResult(kind);
  };
  snap.pay(token, {
    onSuccess: () => notify("status"),
    onPending: () => notify("status"),
    onError: () => notify("status"),
    onClose: () => notify("closed"),
  });
}

/** Closes the popup if `sessionId` is still the active session. */
export function hide(sessionId: string) {
  if (active && active.sessionId === sessionId) hideActive();
}

/** `window.SaveBiteSnap` of the Flutter web build. */
export const SaveBiteSnap = Object.freeze({ pay, hide });
