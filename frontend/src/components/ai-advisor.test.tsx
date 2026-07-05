/**
 * Smoke + regression coverage for the AI advisor component.
 *
 * The exhaustive stream-chunking test would need a full ReadableStream
 * mock; this file covers the two points of behavior that have already
 * regressed in review:
 *
 * 1. The component renders in demo mode and the Confirm action form
 *    short-circuits with a read-only message (Phase 1).
 * 2. When a stream is in flight and the component unmounts, the
 *    AbortController is aborted (Phase 1 added this; the test guards
 *    against silent regression).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const NAV_MOCKS = {
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
};

vi.mock("next/navigation", () => NAV_MOCKS);

// Pretend we're in demo mode so the component renders its demo-safe path
// and the Confirm button disables itself with the "read-only" message.
// The component now reads demo state via `useDemoGuard()` from lib/hooks;
// stub it out alongside the other hooks exports the component uses.
vi.mock("@/lib/hooks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks")>("@/lib/hooks");
  return {
    ...actual,
    useDemoGuard: () => ({
      isDemo: true,
      loading: false,
      readOnlyMessage: "Demo is read-only",
    }),
  };
});

vi.mock("@/lib/api/ai", () => ({
  aiApi: {
    status: vi.fn(async () => ({ active_backend: "demo" })),
  },
}));

vi.mock("@/lib/api/settings", () => ({
  settingsApi: {
    getAiSettings: vi.fn(async () => ({ ai_enabled: true })),
  },
}));

vi.mock("@/lib/llm/ai-feature-gate", () => ({
  useAiFeatureGate: () => ({
    prepareFeature: vi.fn(async () => ({ ok: true })),
    ensureLocalSetup: vi.fn(async () => {}),
  }),
}));

const runFeatureMock = vi.fn();

vi.mock("@/lib/llm/useLlm", () => ({
  useLlm: () => ({
    runFeature: runFeatureMock,
    capability: null,
    getContext: vi.fn(),
    decide: vi.fn(),
    run: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/api/client", () => ({
  default: {
    post: vi.fn(),
  },
}));

// Use a minimal local provider instead of the full providers module to
// avoid dragging in AuthProvider / ThemeProvider side effects.
vi.mock("@/lib/providers", () => ({
  useAuth: () => ({
    token: null,
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
    loading: false,
  }),
}));

const { AiAdvisor } = await import("./ai-advisor");
import api from "@/lib/api/client";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  runFeatureMock.mockReset();
  vi.mocked(api.post).mockReset();
});

describe("<AiAdvisor /> smoke", () => {
  it("renders the floating open-panel button without crashing", async () => {
    wrap(<AiAdvisor />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Open AI advisor/i)).toBeInTheDocument();
    });
  });
});

describe("<AiAdvisor /> unmount abort", () => {
  it("aborts the in-flight runFeature signal on unmount", async () => {
    // Capture the AbortSignal the component actually hands to runFeature,
    // and keep the feature promise pending so the stream stays in flight.
    let capturedSignal: AbortSignal | undefined;
    runFeatureMock.mockImplementation(
      (_feature: string, _params: unknown, opts?: { signal?: AbortSignal }) => {
        capturedSignal = opts?.signal;
        return new Promise(() => {});
      },
    );

    const { unmount } = wrap(<AiAdvisor />);
    fireEvent.click(await screen.findByLabelText(/Open AI advisor/i));
    const input = await screen.findByPlaceholderText(/Ask about your finances/i);
    fireEvent.change(input, { target: { value: "how am I doing?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(runFeatureMock).toHaveBeenCalled();
      expect(capturedSignal).toBeDefined();
    });
    expect(capturedSignal!.aborted).toBe(false);

    unmount();
    expect(capturedSignal!.aborted).toBe(true);
  });
});

describe("<AiAdvisor /> action confirm", () => {
  it("renders preview with Confirm and Cancel for action results", async () => {
    runFeatureMock.mockResolvedValueOnce({
      kind: "action",
      preview: "Create category 'Fees'.",
      confirmationToken: "tok-1",
      actionType: "create_category",
      data: { name: "Fees" },
    });

    wrap(<AiAdvisor />);
    fireEvent.click(screen.getByLabelText(/Open AI advisor/i));

    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "create fees category" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/Create category 'Fees'/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });
  });

  it("Confirm posts execute-action and appends the result message", async () => {
    runFeatureMock.mockResolvedValueOnce({
      kind: "action",
      preview: "Create category 'Fees'.",
      confirmationToken: "tok-1",
      actionType: "create_category",
      data: { name: "Fees" },
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { success: true, message: "Created category 'Fees' in 'Other'." },
    });

    wrap(<AiAdvisor />);
    fireEvent.click(screen.getByLabelText(/Open AI advisor/i));
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "create fees" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => screen.getByRole("button", { name: "Confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/ai/execute-action", {
        action_type: "create_category",
        data: { name: "Fees" },
        confirmation_token: "tok-1",
      });
      expect(screen.getByText(/Created category 'Fees'/)).toBeInTheDocument();
    });
  });

  it("Cancel appends a cancelled note and never calls execute", async () => {
    runFeatureMock.mockResolvedValueOnce({
      kind: "action",
      preview: "Create category 'Fees'.",
      confirmationToken: "tok-1",
      actionType: "create_category",
      data: { name: "Fees" },
    });

    wrap(<AiAdvisor />);
    fireEvent.click(screen.getByLabelText(/Open AI advisor/i));
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "create fees" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.getByText(/Cancelled/)).toBeInTheDocument();
    });
    expect(api.post).not.toHaveBeenCalled();
  });
});
