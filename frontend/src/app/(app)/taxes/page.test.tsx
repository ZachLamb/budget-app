import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TaxesPage from "./page";
import { taxApi } from "@/lib/api/tax";
import type { ProjectionEnvelope, TaxProfile, Paystub, PriorYearReturn } from "@/lib/api/tax";

vi.mock("@/lib/api/tax", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/tax")>();
  return {
    ...actual,
    taxApi: {
      ...actual.taxApi,
      profile: vi.fn(),
      paystubs: vi.fn(),
      priorYear: vi.fn(),
      projection: vi.fn(),
      impact: vi.fn(),
    },
  };
});

const emptyProfile: TaxProfile = {
  filing_status: null,
  walkthrough_answers: null,
  walkthrough_completed_at: null,
  de_minimis_election: false,
};

const unavailable: ProjectionEnvelope = {
  year: new Date().getFullYear(),
  available: false,
  missing: ["filing_status", "paystub"],
  remaining_pay_periods: 0,
  projection: null,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaxesPage />
    </QueryClientProvider>
  );
}

describe("TaxesPage", () => {
  it("renders the degraded state without a bare $0.00 when the projection is unavailable", async () => {
    vi.mocked(taxApi.profile).mockResolvedValue(emptyProfile);
    vi.mocked(taxApi.paystubs).mockResolvedValue([] as Paystub[]);
    vi.mocked(taxApi.priorYear).mockResolvedValue(null as unknown as PriorYearReturn);
    vi.mocked(taxApi.projection).mockResolvedValue(unavailable);

    renderPage();

    await waitFor(() => expect(screen.getAllByText(/how you file/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
    // Withholding card only renders once the projection is available.
    expect(screen.queryByText(/is enough being held back/i)).not.toBeInTheDocument();
    // Next-dollar figures are unavailable too, so no impact numbers are guessed.
    expect(taxApi.impact).not.toHaveBeenCalled();
  });
});
