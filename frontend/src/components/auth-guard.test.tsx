/**
 * Regression: AiAdvisor lives in AuthGuard but must sit inside AiFeatureGateProvider.
 * Commit 6d1cbe9 wrapped only route children, crashing every authenticated page on load.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/providers", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "a@b.com" },
    loading: false,
    token: "t",
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks")>("@/lib/hooks");
  return {
    ...actual,
    useDemoGuard: () => ({ isDemo: true, loading: false, readOnlyMessage: "Demo" }),
  };
});

vi.mock("./navigation", () => ({
  Navigation: () => <nav data-testid="nav" />,
  MobileHeader: () => null,
}));

vi.mock("./mobile-sync-banner", () => ({ MobileSyncBanner: () => null }));
vi.mock("./demo-banner", () => ({ DemoBanner: () => null }));
vi.mock("./error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/api/ai", () => ({
  aiApi: { status: vi.fn(async () => ({ active_backend: "demo" })) },
}));

vi.mock("@/lib/api/settings", () => ({
  settingsApi: { getAiSettings: vi.fn(async () => ({ ai_enabled: true })) },
}));

vi.mock("@/lib/api/llm", () => ({
  llmApi: { listCloudConsent: vi.fn(async () => []) },
}));

const { AuthGuard } = await import("./auth-guard");

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
});

describe("AuthGuard shell", () => {
  it("renders AiAdvisor inside AiFeatureGateProvider without throwing", async () => {
    wrap(
      <AuthGuard>
        <p>page content</p>
      </AuthGuard>,
    );
    await waitFor(() => {
      expect(screen.getByText("page content")).toBeInTheDocument();
      expect(screen.getByLabelText(/Open AI advisor/i)).toBeInTheDocument();
    });
  });
});
