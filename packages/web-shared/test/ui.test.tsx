import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoogleLoginButton, LoginCard, StatusPill } from "../src/ui";
import { AuthContext } from "../src/auth";
import type { ReactNode } from "react";

const signInWithOAuth = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/login",
}));

vi.mock("../src/client", () => ({
  supabaseBrowser: () => ({ auth: { signInWithOAuth } }),
  resetBrowserClient: () => {},
}));

function withAuth(node: ReactNode, user: { id: string } | null) {
  return (
    <AuthContext.Provider
      value={{ session: null, user: user as never, loading: false, signOut: vi.fn() }}
    >
      {node}
    </AuthContext.Provider>
  );
}

function setSearch(search: string) {
  window.history.replaceState({}, "", `/login${search}`);
}

beforeEach(() => {
  setSearch("");
  process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL = "http://localhost:3000/auth/callback";
  signInWithOAuth.mockResolvedValue({ error: null });
  push.mockReset();
  signInWithOAuth.mockClear();
});

describe("StatusPill", () => {
  it("translates known statuses to Indonesian", () => {
    render(<StatusPill status="ready" />);
    expect(screen.getByText("Siap diambil")).toBeInTheDocument();
  });

  it("falls back to the raw status for unknown values", () => {
    render(<StatusPill status="some_new_state" />);
    expect(screen.getByText("some_new_state")).toBeInTheDocument();
  });
});

describe("LoginCard", () => {
  it("offers both roles and defaults to consumer", () => {
    render(withAuth(<LoginCard />, null));
    expect(screen.getByRole("button", { name: /Konsumen/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Merchant/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("pre-selects the merchant role when requested", () => {
    render(withAuth(<LoginCard initialMerchant />, null));
    expect(screen.getByRole("button", { name: /Merchant/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows an OAuth error", () => {
    render(withAuth(<LoginCard error="Gagal masuk" />, null));
    expect(screen.getByRole("alert")).toHaveTextContent("Gagal masuk");
  });
});

describe("GoogleLoginButton", () => {
  it("requests a same-origin callback with a safe default next", async () => {
    setSearch("");
    render(<GoogleLoginButton />);
    await userEvent.click(screen.getByRole("button", { name: /Lanjutkan dengan Google/i }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    const { redirectTo } = signInWithOAuth.mock.calls[0][0].options;
    const url = new URL(redirectTo);
    expect(url.origin + url.pathname).toBe("http://localhost:3000/auth/callback");
    expect(url.searchParams.get("next")).toBe("/");
  });

  it("honours a same-origin next path", async () => {
    setSearch("?next=%2Forders%3Forder%3Dabc");
    render(<GoogleLoginButton />);
    await userEvent.click(screen.getByRole("button", { name: /Lanjutkan dengan Google/i }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    expect(new URL(signInWithOAuth.mock.calls[0][0].options.redirectTo).searchParams.get("next")).toBe(
      "/orders?order=abc",
    );
  });

  it.each([
    ["https://evil.example/steal", "/"],
    ["//evil.example/steal", "/"],
    ["/\\evil.example", "/"],
  ])("never forwards an off-site next target (%s)", async (next, expected) => {
    setSearch(`?next=${encodeURIComponent(next)}`);
    render(<GoogleLoginButton />);
    await userEvent.click(screen.getByRole("button", { name: /Lanjutkan dengan Google/i }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    expect(new URL(signInWithOAuth.mock.calls[0][0].options.redirectTo).searchParams.get("next")).toBe(
      expected,
    );
  });

  it("does not let a consumer session be redirected into the merchant workspace", async () => {
    setSearch("?next=%2Fmerchant%2Fbalance");
    render(<GoogleLoginButton />);
    await userEvent.click(screen.getByRole("button", { name: /Lanjutkan dengan Google/i }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    expect(new URL(signInWithOAuth.mock.calls[0][0].options.redirectTo).searchParams.get("next")).toBe(
      "/",
    );
  });

  it("does let a merchant session be redirected within the merchant workspace", async () => {
    setSearch("?next=%2Fmerchant%2Forders");
    render(<GoogleLoginButton merchant />);
    await userEvent.click(screen.getByRole("button", { name: /Lanjutkan dengan Google/i }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    expect(new URL(signInWithOAuth.mock.calls[0][0].options.redirectTo).searchParams.get("next")).toBe(
      "/merchant/orders",
    );
  });

  it("surfaces an OAuth failure instead of silently doing nothing", async () => {
    signInWithOAuth.mockResolvedValueOnce({ error: { message: "Popup ditolak" } });
    render(<GoogleLoginButton />);
    await userEvent.click(screen.getByRole("button", { name: /Lanjutkan dengan Google/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?error=Popup%20ditolak"));
  });
});

describe("LoginCard continue button for an already signed-in user", () => {
  it("honours next instead of always dumping the user at the workspace root", async () => {
    // Regression: the old code ignored ?next and pushed /merchant, so a merchant
    // deep-linking to /merchant/orders lost their target.
    setSearch("?role=merchant&next=%2Fmerchant%2Fredeem");
    render(withAuth(<LoginCard initialMerchant next="/merchant/redeem" />, { id: "u1" }));

    await userEvent.click(screen.getByRole("button", { name: /Lanjutkan sebagai Merchant/i }));
    expect(push).toHaveBeenCalledWith("/merchant/redeem");
  });

  it("refuses an off-site next even when already signed in", async () => {
    render(withAuth(<LoginCard next="https://evil.example" />, { id: "u1" }));
    await userEvent.click(screen.getByRole("button", { name: /Lanjutkan sebagai Konsumen/i }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("keeps a consumer out of the merchant workspace", async () => {
    render(withAuth(<LoginCard next="/merchant/balance" />, { id: "u1" }));
    await userEvent.click(screen.getByRole("button", { name: /Lanjutkan sebagai Konsumen/i }));
    expect(push).toHaveBeenCalledWith("/");
  });
});
