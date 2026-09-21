import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeductionsPage from "./page";
import { deductionsApi } from "@/lib/api/deductions";

vi.mock("@/lib/api/deductions", () => ({
  deductionsApi: { summary: vi.fn() },
}));

const empty = {
  year: 2026, lines: [], total: 0, estimated_tax_savings: null,
  suggested_withholding_reduction_per_period: null, business_total: 0,
  personal_itemized_total: 0, personal_itemized_value: null,
  standard_deduction: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DeductionsPage />
    </QueryClientProvider>
  );
}

describe("DeductionsPage", () => {
  beforeEach(() => {
    vi.mocked(deductionsApi.summary).mockResolvedValue(empty);
  });

  it("asks for the current year first", async () => {
    renderPage();
    await waitFor(() =>
      expect(deductionsApi.summary).toHaveBeenCalledWith(new Date().getFullYear())
    );
  });

  it("can look back at an earlier year, so January does not hide last year", async () => {
    renderPage();
    const previous = new Date().getFullYear() - 1;

    await userEvent.selectOptions(
      await screen.findByLabelText(/tax year/i),
      String(previous)
    );

    await waitFor(() => expect(deductionsApi.summary).toHaveBeenCalledWith(previous));
  });
});
