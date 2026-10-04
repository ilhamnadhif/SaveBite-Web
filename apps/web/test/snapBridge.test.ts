// @vitest-environment jsdom
/**
 * The Snap.js bridge: the checkout renders inside the payment card (embed
 * mode) with options Snap.js accepts, every session reports at most one hint,
 * and a replaced or hidden session stays silent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaveBiteSnap, type SnapResultKind } from "../screens/consumer/snapBridge";

const CLIENT_KEY = "Mid-client-test12345";
const TOKEN = "snap-token-1234";
const CONTAINER = "snap-checkout-r1";

/** Every option name `snap.pay` / `snap.embed` accept; Snap.js throws on others. */
const SNAP_OPTIONS = new Set([
  "onSuccess",
  "onPending",
  "onError",
  "onClose",
  "skipOrderSummary",
  "autoCloseDelay",
  "language",
  "enabledPayments",
  "skipCustomerDetails",
  "showOrderId",
  "isDemoMode",
  "creditCardNumber",
  "creditCardCvv",
  "creditCardExpiry",
  "customerEmail",
  "customerPhone",
  "uiMode",
  "gopayMode",
  "selectedPaymentType",
  "hideCloseButton",
]);

type Callbacks = { onSuccess: () => void; onPending: () => void; onError: () => void; onClose: () => void };
type Call = { method: "pay" | "embed" | "hide"; token?: string; options?: Callbacks & Record<string, unknown> };

const calls: Call[] = [];
const scripts: HTMLScriptElement[] = [];
const fakeSnap: {
  pay: (token: string, options: Call["options"]) => void;
  embed?: (token: string, options: Call["options"]) => void;
  hide: () => void;
} = {
  pay: (token, options) => calls.push({ method: "pay", token, options }),
  embed: (token, options) => calls.push({ method: "embed", token, options }),
  hide: () => calls.push({ method: "hide" }),
};

const opened = (method: "pay" | "embed") => calls.filter((call) => call.method === method);

beforeEach(() => {
  calls.length = 0;
  document.body.innerHTML = `<div id="${CONTAINER}"></div>`;
  // jsdom never fetches the script; stand in for Snap.js finishing its load.
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
    if (!(node instanceof HTMLScriptElement)) return append(node);
    scripts.push(node);
    (window as unknown as { snap: typeof fakeSnap }).snap = fakeSnap;
    queueMicrotask(() => node.onload?.(new Event("load")));
    return node;
  });
});

describe("SaveBiteSnap.embed", () => {
  it("loads Snap.js once and renders the checkout inside the card", async () => {
    const results: SnapResultKind[] = [];
    await expect(
      SaveBiteSnap.embed(TOKEN, CLIENT_KEY, "sandbox", "session-1", CONTAINER, (kind) => results.push(kind)),
    ).resolves.toBe("embedded");
    await SaveBiteSnap.embed(TOKEN, CLIENT_KEY, "sandbox", "session-2", CONTAINER, () => {});

    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe("https://app.sandbox.midtrans.com/snap/snap.js");
    expect(scripts[0].getAttribute("data-client-key")).toBe(CLIENT_KEY);
    const [first] = opened("embed");
    expect(first.token).toBe(TOKEN);
    expect(first.options).toMatchObject({ embedId: CONTAINER, hideCloseButton: true, language: "id" });
    for (const name of Object.keys(first.options ?? {})) {
      expect(SNAP_OPTIONS.has(name) || name === "embedId", name).toBe(true);
    }
    expect(opened("pay")).toHaveLength(0);
    expect(results).toEqual([]);
  });

  it("reports one hint per session", async () => {
    const results: SnapResultKind[] = [];
    await SaveBiteSnap.embed(TOKEN, CLIENT_KEY, "sandbox", "session-1", CONTAINER, (kind) => results.push(kind));
    const { options } = opened("embed")[0];

    options?.onPending();
    options?.onSuccess();
    options?.onClose();

    expect(results).toEqual(["status"]);
  });

  it("reports a close without a result as closed", async () => {
    const results: SnapResultKind[] = [];
    await SaveBiteSnap.embed(TOKEN, CLIENT_KEY, "sandbox", "session-1", CONTAINER, (kind) => results.push(kind));

    opened("embed")[0].options?.onClose();

    expect(results).toEqual(["closed"]);
  });

  it("falls back to the popup when Snap.js has no embed mode", async () => {
    const embed = fakeSnap.embed;
    delete fakeSnap.embed;
    try {
      const results: SnapResultKind[] = [];
      await expect(
        SaveBiteSnap.embed(TOKEN, CLIENT_KEY, "sandbox", "session-1", CONTAINER, (kind) => results.push(kind)),
      ).resolves.toBe("popup");

      const [popup] = opened("pay");
      expect(Object.keys(popup.options ?? {}).sort()).toEqual(["onClose", "onError", "onPending", "onSuccess"]);
      popup.options?.onError();
      expect(results).toEqual(["status"]);
    } finally {
      fakeSnap.embed = embed;
    }
  });

  it("never opens a session that was replaced while Snap.js loaded", async () => {
    const stale: SnapResultKind[] = [];
    const first = SaveBiteSnap.embed(TOKEN, CLIENT_KEY, "sandbox", "session-1", CONTAINER, (kind) => stale.push(kind));
    const second = SaveBiteSnap.embed("snap-token-5678", CLIENT_KEY, "sandbox", "session-2", CONTAINER, () => {});

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBe("embedded");
    expect(opened("embed").map((call) => call.token)).toEqual(["snap-token-5678"]);
  });

  it("hides only the active session and silences it", async () => {
    const results: SnapResultKind[] = [];
    await SaveBiteSnap.embed(TOKEN, CLIENT_KEY, "sandbox", "session-1", CONTAINER, (kind) => results.push(kind));
    const { options } = opened("embed")[0];
    calls.length = 0;

    SaveBiteSnap.hide("session-other");
    expect(calls).toEqual([]);
    SaveBiteSnap.hide("session-1");
    expect(calls).toEqual([{ method: "hide" }]);

    options?.onSuccess();
    expect(results).toEqual([]);
  });

  it("rejects a container that is not on the page", async () => {
    await expect(
      SaveBiteSnap.embed(TOKEN, CLIENT_KEY, "sandbox", "session-1", "snap-checkout-gone", () => {}),
    ).rejects.toThrow("Snap checkout container is missing");
    await expect(SaveBiteSnap.embed(TOKEN, CLIENT_KEY, "sandbox", "session-1", "#bad id", () => {})).rejects.toThrow(
      "Invalid Snap checkout container",
    );
    await expect(SaveBiteSnap.embed("bad token", CLIENT_KEY, "sandbox", "session-1", CONTAINER, () => {})).rejects.toThrow(
      "Invalid Snap checkout session",
    );
    expect(opened("embed")).toHaveLength(0);
  });
});
