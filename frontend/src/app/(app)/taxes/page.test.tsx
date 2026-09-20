import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TaxesPage from "./page";
import { taxApi } from "@/lib/api/tax";
import type { ProjectionEnvelope, TaxProfile, Paystub, PriorYearReturn, ImpactResult } from "@/lib/api/tax";

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

const projection = {
  agi: 179000, magi_for_pal: 179000, deduction_taken: 16100,
  deduction_kind: "standard" as const, standard_deduction: 16100,
  itemized_total: 0, taxable_income: 162900, federal_income_tax: 31694,
  social_security_tax: 11098, medicare_tax: 2595.5,
  additional_medicare_tax: 0, state_tax: 7167.6, total_liability: 52555.1,
  total_withheld_projected: 50000, refund_or_amount_due: -2555.1,
  effective_rate: 29.36, schedule_e_allowed_loss: 0,
  schedule_e_suspended_loss: 0,
  safe_harbor: {
    status: "met" as const, test_used: "90_percent_current", required_payment: 47000,
    projected_payment: 50000, shortfall: 0, per_period_to_close: 0,
    reason: "You are on track.",
  },
  explain: [
    { label: "Wages", amount: 179000, detail: "Year-to-date plus projected." },
  ],
};

const available: ProjectionEnvelope = {
  year: new Date().getFullYear(),
  available: true,
  missing: [],
  remaining_pay_periods: 3,
  projection,
};

const wagesImpact: ImpactResult = {
  kind: "extra_wages", change_amount: 1000, amount_of_tax: 360.5,
  blended_rate_percent: 36.05, note: "x",
};

const deferralImpact: ImpactResult = {
  kind: "extra_pretax_401k", change_amount: 1000, amount_of_tax: -284,
  blended_rate_percent: -28.4, note: "y",
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

  it("fetches and shows the next-dollar impact figures once the projection is available", async () => {
    vi.mocked(taxApi.profile).mockResolvedValue(emptyProfile);
    vi.mocked(taxApi.paystubs).mockResolvedValue([] as Paystub[]);
    vi.mocked(taxApi.priorYear).mockResolvedValue(null as unknown as PriorYearReturn);
    vi.mocked(taxApi.projection).mockResolvedValue(available);
    vi.mocked(taxApi.impact).mockImplementation((body) =>
      Promise.resolve(body.kind === "extra_wages" ? wagesImpact : deferralImpact)
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("$360.50")).toBeInTheDocument());
    expect(screen.getByText("$284.00")).toBeInTheDocument();
    expect(taxApi.impact).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "extra_wages" })
    );
    expect(taxApi.impact).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "extra_pretax_401k" })
    );
  });
});
