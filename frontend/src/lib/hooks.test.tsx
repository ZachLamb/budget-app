/**
 * useDemoGuard is the single place the UI consults to decide whether to
 * render read-only affordances. Two sources feed it:
 *
 *  - `isDemo`: per-user flag (user.is_demo_user). False for admins even on a
 *    demo-enabled backend, so admins keep full write access.
 *  - `serverDemoMode`: server-wide flag from /api/config. Used by the login
 *    page to show "Try the Demo" button. Falls back to build-time flag until
 *    the query resolves.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock("@/lib/api/config", () => ({
  configApi: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

vi.mock("@/lib/providers", () => ({
  useAuth: () => useAuthMock(),
}));

// Build-time flag reads from process.env at module import; emulate the
// "not built as demo" state for the test runner.
vi.mock("@/lib/demo-mode", () => ({ isDemoMode: false }));

const { useDemoGuard } = await import("./hooks");

function wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getMock.mockReset();
  useAuthMock.mockReturnValue({ user: null });
});

describe("useDemoGuard", () => {
  it("isDemo=true when the logged-in user is the demo account", async () => {
    getMock.mockResolvedValueOnce({
      demo_mode: true,
      auth_methods: { password: true, passkey: true, google: false },
    });
    useAuthMock.mockReturnValue({ user: { is_demo_user: true, email: "demo@snacksbudget.app" } });

    const { result } = renderHook(() => useDemoGuard(), { wrapper: wrap });

    expect(result.current.isDemo).toBe(true);
    expect(result.current.readOnlyMessage).toMatch(/demo is read-only/i);
  });

  it("isDemo=false for an admin on a demo-enabled backend", async () => {
    getMock.mockResolvedValueOnce({
      demo_mode: true,
      auth_methods: { password: true, passkey: true, google: false },
    });
    useAuthMock.mockReturnValue({ user: { is_demo_user: false, email: "admin@example.com" } });

    const { result } = renderHook(() => useDemoGuard(), { wrapper: wrap });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isDemo).toBe(false);
  });

  it("serverDemoMode reflects the server flag once the query resolves", async () => {
    getMock.mockResolvedValueOnce({
      demo_mode: true,
      auth_methods: { password: true, passkey: true, google: false },
    });

    const { result } = renderHook(() => useDemoGuard(), { wrapper: wrap });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.serverDemoMode).toBe(true);
  });

  it("falls back to build-time flag for isDemo while no user is loaded", () => {
    getMock.mockReturnValue(new Promise(() => {})); // pending forever
    useAuthMock.mockReturnValue({ user: null });

    const { result } = renderHook(() => useDemoGuard(), { wrapper: wrap });

    // build-time flag is mocked false; user is null → falls back to build-time
    expect(result.current.isDemo).toBe(false);
    expect(result.current.loading).toBe(true);
  });
});
