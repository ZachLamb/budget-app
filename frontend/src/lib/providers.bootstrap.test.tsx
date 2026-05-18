/**
 * AuthProvider bootstrap sequence (post-cookie-migration).
 *
 * The provider always calls /api/auth/me on mount, because the source of
 * truth for "am I logged in" is now the httpOnly session cookie — JS can't
 * read it, so the only way to find out is to ask the server.
 *
 * Three outcomes:
 * 1. /me rejects (no valid session) → loading ends, user stays null,
 *    legacy localStorage entries are cleared.
 * 2. /me resolves → loading ends, user populated. `token` on context is
 *    always null (session is httpOnly cookie only).
 * 3. /me hangs (rare) → loading stays true. Not exercised — covered by
 *    React Query timeouts elsewhere.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const meMock = vi.fn();
const logoutMock = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/lib/toast-error", () => ({
  toastPlainError: vi.fn(),
  toastErrorDiagnostic: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  authApi: {
    me: () => meMock(),
    logout: () => logoutMock(),
  },
}));

// Import after the mock so Providers picks up the stubbed authApi.
const { Providers, useAuth } = await import("./providers");

function AuthReadout() {
  const { user, token, loading } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="token">{token ?? "null"}</div>
      <div data-testid="user">{user?.id ?? "null"}</div>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  meMock.mockReset();
});

describe("Providers / AuthProvider bootstrap", () => {
  it("finishes loading with no user when /me rejects (no valid session)", async () => {
    // Cookie-based auth: there's no client-readable signal that the user
    // is logged in. The provider always calls /me; rejection means
    // "no session" and we land in the logged-out state.
    meMock.mockRejectedValueOnce(new Error("401"));
    render(
      <Providers>
        <AuthReadout />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("token").textContent).toBe("null");
    expect(screen.getByTestId("user").textContent).toBe("null");
    expect(meMock).toHaveBeenCalledTimes(1);
  });

  it("populates user when /me resolves", async () => {
    meMock.mockResolvedValueOnce({ id: "u-1", email: "a@b.co" });

    render(
      <Providers>
        <AuthReadout />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user").textContent).toBe("u-1");
    expect(meMock).toHaveBeenCalledTimes(1);
  });

  it("does not expose legacy localStorage token on context", async () => {
    localStorage.setItem("token", "saved-token");
    meMock.mockResolvedValueOnce({ id: "u-1", email: "a@b.co" });

    render(
      <Providers>
        <AuthReadout />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("token").textContent).toBe("null");
    expect(screen.getByTestId("user").textContent).toBe("u-1");
  });

  it("shows access message and clears user when /me returns 403", async () => {
    const { toastPlainError } = await import("@/lib/toast-error");
    const err = new Error("403") as Error & {
      response?: { status: number; data: { detail: string } };
    };
    err.response = {
      status: 403,
      data: { detail: "Your account is awaiting approval by an administrator." },
    };
    meMock.mockRejectedValueOnce(err);
    render(
      <Providers>
        <AuthReadout />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user").textContent).toBe("null");
    expect(toastPlainError).toHaveBeenCalledWith(
      "Your account is awaiting approval by an administrator.",
    );
  });

  it("clears legacy localStorage when /me rejects", async () => {
    localStorage.setItem("token", "expired-token");
    localStorage.setItem("user", JSON.stringify({ id: "stale" }));
    meMock.mockRejectedValueOnce(new Error("401"));

    render(
      <Providers>
        <AuthReadout />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("token").textContent).toBe("null");
    expect(screen.getByTestId("user").textContent).toBe("null");
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });
});
