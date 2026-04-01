import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MobileSyncBanner } from "./mobile-sync-banner";

vi.mock("@/lib/hooks", () => ({
  useIsClient: () => true,
}));

const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }));

vi.mock("@/lib/api/sync", () => ({
  syncApi: {
    status: () => statusMock(),
    trigger: vi.fn().mockResolvedValue({}),
  },
}));

function renderBanner() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MobileSyncBanner />
    </QueryClientProvider>,
  );
}

describe("MobileSyncBanner", () => {
  beforeEach(() => {
    statusMock.mockReset();
  });

  it("renders nothing when last sync succeeded", async () => {
    statusMock.mockResolvedValue({
      last_sync: {
        status: "success",
        completed_at: "2025-01-01T00:00:00Z",
        error_message: null,
      },
      syncing: false,
      is_stale: false,
    });
    const { container } = renderBanner();
    await vi.waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("shows error guidance when last sync failed", async () => {
    statusMock.mockResolvedValue({
      last_sync: {
        status: "error",
        completed_at: "2025-01-01T00:00:00Z",
        error_message: "Token expired",
      },
      syncing: false,
      is_stale: false,
    });
    renderBanner();
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(await screen.findByText(/Token expired/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("shows syncing state while a sync is running", async () => {
    statusMock.mockResolvedValue({
      last_sync: {
        status: "success",
        completed_at: "2025-01-01T00:00:00Z",
        error_message: null,
      },
      syncing: true,
      is_stale: true,
    });
    renderBanner();
    expect(await screen.findByText(/Updating your data/)).toBeInTheDocument();
  });

  it("shows stale guidance when data is stale and last sync succeeded", async () => {
    statusMock.mockResolvedValue({
      last_sync: {
        status: "success",
        completed_at: "2025-01-01T00:00:00Z",
        error_message: null,
      },
      syncing: false,
      is_stale: true,
    });
    renderBanner();
    expect(await screen.findByText(/Bank data may be outdated/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sync now/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Details" })).toHaveAttribute("href", "/settings");
  });
});
