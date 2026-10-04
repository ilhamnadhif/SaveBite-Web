// @vitest-environment jsdom
/**
 * The web `SnapCheckoutView`: the Snap checkout appears inside the payment
 * card, and the card never stays an empty white box. While Snap loads it says
 * so, and after Snap closes it explains what happened and how to continue.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapPresentation, SnapResultKind } from "../screens/consumer/snapBridge";

const bridge = vi.hoisted(() => ({
  embed: vi.fn(),
  hide: vi.fn(),
}));
vi.mock("../screens/consumer/snapBridge", () => ({ SaveBiteSnap: bridge }));

import { SnapCheckoutView } from "../screens/consumer/SnapCheckoutView";
import { SnapCheckoutSession } from "../screens/consumer/snapCheckoutSession";

type EmbedArgs = [string, string, string, string, string, (kind: SnapResultKind) => void];

const session = SnapCheckoutSession.tryParse("https://app.sandbox.midtrans.com/snap/v4/redirection/redirect-1234", {
  snapToken: "snap-token-1234",
  clientKey: "Mid-client-test12345",
  environment: "sandbox",
  supabaseUrl: "https://project.supabase.co",
});

let presentation: Promise<SnapPresentation | null>;

function renderView() {
  if (session === null) throw new Error("test session did not parse");
  const onStatusHint = vi.fn();
  const onError = vi.fn();
  const onReopen = vi.fn();
  render(<SnapCheckoutView session={session} onStatusHint={onStatusHint} onError={onError} onReopen={onReopen} />);
  return { onStatusHint, onError, onReopen };
}

const lastEmbed = (): EmbedArgs => bridge.embed.mock.calls.at(-1) as EmbedArgs;

/** What Snap.js does in embed mode: add its iframe hidden, then show it. */
async function snapShowsCheckout() {
  const host = document.getElementById(lastEmbed()[4]);
  if (host === null) throw new Error("no checkout container");
  const frame = document.createElement("iframe");
  frame.style.display = "none";
  await act(async () => {
    host.appendChild(frame);
  });
  await act(async () => {
    frame.style.display = "block";
  });
  return frame;
}

beforeEach(() => {
  presentation = Promise.resolve("embedded");
  bridge.embed.mockImplementation(() => presentation);
});

afterEach(() => {
  cleanup();
});

describe("SnapCheckoutView", () => {
  it("embeds the checkout in the card and shows a loading state until Snap shows it", async () => {
    renderView();

    expect(screen.getByText("Memuat halaman pembayaran…")).toBeTruthy();
    const [token, clientKey, environment, , embedId] = lastEmbed();
    expect([token, clientKey, environment]).toEqual(["snap-token-1234", "Mid-client-test12345", "sandbox"]);
    expect(document.getElementById(embedId)).not.toBeNull();

    await snapShowsCheckout();

    await waitFor(() => expect(screen.queryByText("Memuat halaman pembayaran…")).toBeNull());
  });

  it("checks the status after a Snap result and offers the QRIS again", async () => {
    const { onStatusHint } = renderView();
    const frame = await snapShowsCheckout();

    await act(async () => {
      lastEmbed()[5]("status");
      frame.remove();
    });

    expect(onStatusHint).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Memeriksa status pembayaran…")).toBeTruthy();
  });

  it("explains a closed checkout and reopens it on request", async () => {
    const { onStatusHint, onReopen } = renderView();
    await snapShowsCheckout();
    const firstSession = lastEmbed()[3];

    await act(async () => {
      lastEmbed()[5]("closed");
    });

    expect(onStatusHint).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Halaman pembayaran ditutup")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tampilkan QRIS lagi/ }));

    await waitFor(() => expect(bridge.embed).toHaveBeenCalledTimes(2));
    expect(onReopen).toHaveBeenCalledTimes(1);
    expect(lastEmbed()[3]).not.toBe(firstSession);
    expect(bridge.hide).toHaveBeenCalledWith(firstSession);
    expect(screen.getByText("Memuat halaman pembayaran…")).toBeTruthy();
  });

  it("treats Snap removing its iframe without a result as closed", async () => {
    renderView();
    const frame = await snapShowsCheckout();

    await act(async () => {
      frame.remove();
    });

    await waitFor(() => expect(screen.getByText("Halaman pembayaran ditutup")).toBeTruthy());
  });

  it("reports a checkout that cannot be opened and retries", async () => {
    presentation = Promise.reject(new Error("Snap.js failed to load"));
    const { onError } = renderView();

    await waitFor(() => expect(screen.getByText("Halaman pembayaran belum tampil")).toBeTruthy());
    expect(onError).toHaveBeenCalledWith("Halaman pembayaran belum dapat dibuka. Muat ulang untuk mencoba lagi.");

    presentation = Promise.resolve("embedded");
    fireEvent.click(screen.getByRole("button", { name: /Coba lagi/ }));
    await waitFor(() => expect(bridge.embed).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Memuat halaman pembayaran…")).toBeTruthy();
  });

  it("explains the popup when this Snap.js has no embed mode", async () => {
    presentation = Promise.resolve("popup");
    renderView();

    await waitFor(() => expect(screen.getByText("Pembayaran dibuka di jendela Midtrans")).toBeTruthy());
  });

  it("hides its session when it leaves the screen", async () => {
    renderView();
    const sessionId = lastEmbed()[3];

    cleanup();

    expect(bridge.hide).toHaveBeenCalledWith(sessionId);
  });
});
