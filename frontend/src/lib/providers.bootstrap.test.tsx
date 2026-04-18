/**
 * AuthProvider bootstrap sequence.
 *
 * The provider has three outcomes on mount:
 * 1. no saved token → loading ends immediately; `user`/`token` stay null.
 * 2. saved token + authApi.me() succeeds → `user` and `token` populated.
 * 3. saved token + authApi.me() rejects → localStorage cleared, `token`/`user` reset.
 *
 * These are the surfaces that caused a regression earlier this cycle
 * (bootstrap race; token not cleared on failed /me). Explicit coverage.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const meMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({
  authApi: {
    me: () => meMock(),
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
  it("finishes loading with no user when no token is saved", async () => {
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
    expect(meMock).not.toHaveBeenCalled();
  });

  it("populates user and token when a saved token validates via /me", async () => {
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
    expect(screen.getByTestId("user").textContent).toBe("u-1");
    expect(meMock).toHaveBeenCalledTimes(1);
  });

  it("clears localStorage and state when /me rejects (expired or invalid token)", async () => {
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
    // Both FE state and persisted state are cleared so downstream queries
    // don't run with an invalid token.
    expect(screen.getByTestId("token").textContent).toBe("null");
    expect(screen.getByTestId("user").textContent).toBe("null");
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });
});
