/**
 * useDemoGuard is the single place the UI consults to decide whether to
 * render destructive affordances. The test below locks in two invariants:
 *
 *  1. The server's view wins once the query resolves — protects against a
 *     frontend built without NEXT_PUBLIC_DEMO_MODE from rendering "full
 *     capabilities" UI while the backend is demo and will 403 everything.
 *  2. Until the query resolves, we fall back to the build-time flag so
 *     there's no flash of wrong state on first paint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getMock = vi.fn();

vi.mock("@/lib/api/config", () => ({
  configApi: {
    get: (...args: unknown[]) => getMock(...args),
  },
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
});

describe("useDemoGuard", () => {
  it("reports demo=true when the server says demo_mode is true", async () => {
    getMock.mockResolvedValueOnce({
      demo_mode: true,
      auth_methods: { password: true, passkey: true, google: false },
    });

    const { result } = renderHook(() => useDemoGuard(), { wrapper: wrap });

    await waitFor(() => {
      expect(result.current.isDemo).toBe(true);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.readOnlyMessage).toMatch(/demo is read-only/i);
  });

  it("reports demo=false when the server says demo_mode is false", async () => {
    getMock.mockResolvedValueOnce({
      demo_mode: false,
      auth_methods: { password: true, passkey: true, google: true },
    });

    const { result } = renderHook(() => useDemoGuard(), { wrapper: wrap });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.isDemo).toBe(false);
  });

  it("falls back to the build-time flag while the query is still loading", () => {
    getMock.mockReturnValue(new Promise(() => {})); // pending forever

    const { result } = renderHook(() => useDemoGuard(), { wrapper: wrap });

    // Before the server responds, the hook should reflect the build-time
    // flag (mocked false here) rather than `undefined`.
    expect(result.current.isDemo).toBe(false);
    expect(result.current.loading).toBe(true);
  });
});
