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
 * 2. /me resolves → loading ends, user populated. If a legacy token is
 *    in localStorage, it carries forward in `token` for the transition
 *    window (axios interceptor sends it); otherwise `token` is null.
 * 3. /me hangs (rare) → loading stays true. Not exercised — covered by
 *    React Query timeouts elsewhere.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const meMock = vi.fn();
const logoutMock = vi.fn(async () => ({ ok: true as const }));

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

  it("carries a pre-cookie-migration localStorage token forward as `token`", async () => {
    // Legacy users still have their JWT in localStorage from before the
    // cookie shipped. The axios interceptor uses it as a fallback. The
    // provider exposes it on the context for the same legacy reason.
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
    expect(screen.getByTestId("token").textContent).toBe("saved-token");
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
