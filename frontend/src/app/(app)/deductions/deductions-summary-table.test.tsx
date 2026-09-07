import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DeductionsSummaryTable } from "./deductions-summary-table";
import type { DeductionsSummary } from "@/lib/api/deductions";

const baseSummary: DeductionsSummary = {
  year: 2026,
  lines: [
    { tax_line: "Schedule E — Cleaning", amount: 1240 },
    { tax_line: "Schedule A — Medical", amount: 340 },
  ],
  total: 1580,
  estimated_tax_savings: null,
  suggested_withholding_reduction_per_period: null,
};

describe("DeductionsSummaryTable", () => {
  it("renders each line and the total", () => {
    render(<DeductionsSummaryTable summary={baseSummary} />);
    expect(screen.getByText("Schedule E — Cleaning")).toBeInTheDocument();
    expect(screen.getByText("$1,240.00")).toBeInTheDocument();
    expect(screen.getByText("$1,580.00")).toBeInTheDocument();
  });

  it("shows a prompt instead of a savings figure when settings are incomplete", () => {
    render(<DeductionsSummaryTable summary={baseSummary} />);
    expect(screen.getByText(/add your tax rate/i)).toBeInTheDocument();
  });

  it("shows the estimated savings and withholding nudge when present", () => {
    const summary: DeductionsSummary = {
      ...baseSummary,
      estimated_tax_savings: 417.11,
      suggested_withholding_reduction_per_period: 52.14,
    };
    render(<DeductionsSummaryTable summary={summary} />);
    expect(screen.getByText(/417\.11/)).toBeInTheDocument();
    expect(screen.getByText(/52\.14/)).toBeInTheDocument();
    expect(screen.getByText(/not tax advice/i)).toBeInTheDocument();
  });

  it("shows an empty state with no deductible categories", () => {
    render(<DeductionsSummaryTable summary={{ ...baseSummary, lines: [], total: 0 }} />);
    expect(screen.getByText(/no deductible categories yet/i)).toBeInTheDocument();
  });
});
