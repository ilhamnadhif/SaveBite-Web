import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthGate, AuthContext, useAuth } from "../src/auth";
import type { ReactNode } from "react";

const rpc = vi.fn();
const replace = vi.fn();
let pathname = "/merchant";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
}));

vi.mock("../src/client", () => ({
  supabaseBrowser: () => ({ rpc, auth: { signOut: vi.fn() } }),
}));

function gate(node: ReactNode, user: unknown) {
  return (
    <AuthContext.Provider
      value={{ session: null, user: user as never, loading: false, signOut: vi.fn() }}
    >
      {node}
    </AuthContext.Provider>
  );
}

beforeEach(() => {
  pathname = "/merchant";
  replace.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { id: "store-1" }, error: null });
});

describe("AuthGate for the consumer app", () => {
  it("renders children without requiring a session", () => {
    render(gate(<AuthGate><p>catalog</p></AuthGate>, null));
    expect(screen.getByText("catalog")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("AuthGate for the merchant workspace", () => {
  it("redirects an anonymous visitor to login, preserving the deep link", async () => {
    pathname = "/merchant/orders";
    window.history.replaceState({}, "", "/merchant/orders?status=ready");
    render(gate(<AuthGate merchant><p>orders</p></AuthGate>, null));

    await waitFor(() => expect(replace).toHaveBeenCalled());
    const login = new URL(replace.mock.calls[0][0] as string, "http://localhost");
    expect(login.searchParams.get("role")).toBe("merchant");
    expect(login.searchParams.get("next")).toBe("/merchant/orders?status=ready");
  });

  it("keeps the preserved deep link on our own origin even when it contains an off-site URL", async () => {
    // The current URL is same-origin, so it is safe to echo back. What matters
    // is that the *value* of next stays a path on this origin.
    pathname = "/merchant";
    window.history.replaceState({}, "", "/merchant?ref=https://evil.example");
    render(gate(<AuthGate merchant><p>x</p></AuthGate>, null));

    await waitFor(() => expect(replace).toHaveBeenCalled());
    const next = new URL(replace.mock.calls[0][0] as string, "http://localhost").searchParams.get("next");
    expect(next).toBe("/merchant?ref=https://evil.example");
    expect(next?.startsWith("/")).toBe(true);
    expect(new URL(next!, "http://localhost").origin).toBe("http://localhost");
  });

  it("renders children for a merchant who owns a store", async () => {
    render(gate(<AuthGate merchant><p>dashboard</p></AuthGate>, { id: "u1" }));
    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends a merchant without a store to setup", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    render(gate(<AuthGate merchant><p>dashboard</p></AuthGate>, { id: "u1" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/merchant/setup"));
  });

  it("allows /merchant/setup itself", async () => {
    pathname = "/merchant/setup";
    rpc.mockResolvedValue({ data: null, error: null });
    render(gate(<AuthGate merchant><p>setup</p></AuthGate>, { id: "u1" }));
    expect(await screen.findByText("setup")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("bounces a merchant who already has a store away from setup", async () => {
    // Regression: the setup form used to let an existing merchant create a
    // second store for the same account.
    pathname = "/merchant/setup";
    render(gate(<AuthGate merchant><p>setup</p></AuthGate>, { id: "u1" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/merchant"));
  });

  it("shows an error instead of redirecting when the lookup fails", async () => {
    // Regression: a failed RPC used to be read as "no store", bouncing the
    // merchant to a setup form that then failed on a duplicate key.
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "connection terminated", code: "08006" } });

    render(gate(<AuthGate merchant><p>dashboard</p></AuthGate>, { id: "u1" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/tidak tersedia|koneksi|terputus/i);
    expect(replace).not.toHaveBeenCalledWith("/merchant/setup");
  });

  it("retries the lookup when the user asks", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(gate(<AuthGate merchant><p>dashboard</p></AuthGate>, { id: "u1" }));

    await screen.findByRole("alert");
    rpc.mockResolvedValue({ data: { id: "store-1" }, error: null });
    await userEvent.click(screen.getByRole("button", { name: /coba lagi/i }));

    expect(await screen.findByText("dashboard")).toBeInTheDocument();
  });
});

describe("useAuth", () => {
  function Probe() {
    const { user } = useAuth();
    return <span>{user ? "signed-in" : "anonymous"}</span>;
  }
  it("throws a helpful error outside a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/must be used inside AuthProvider/);
  });
});
