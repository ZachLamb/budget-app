import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeductionsSummaryTable } from "./deductions-summary-table";
import type { DeductionsSummary } from "@/lib/api/deductions";

const base: DeductionsSummary = {
  year: 2026,
  lines: [],
  total: 0,
  estimated_tax_savings: null,
  suggested_withholding_reduction_per_period: null,
  business_total: 0,
  personal_itemized_total: 0,
  personal_itemized_value: null,
  standard_deduction: null,
};

describe("DeductionsSummaryTable", () => {
  it("prompts for setup when no projection is available", () => {
    render(<DeductionsSummaryTable summary={{
      ...base,
      lines: [{ tax_line: "Schedule A — Medical", amount: 5000, deduction_kind: "personal_itemized" }],
      total: 5000, personal_itemized_total: 5000,
    }} />);
    expect(screen.getByText(/set up your taxes/i)).toBeInTheDocument();
  });

  it("explains a zero saving instead of just showing $0.00", () => {
    render(<DeductionsSummaryTable summary={{
      ...base,
      lines: [{ tax_line: "Schedule A — Medical", amount: 5000, deduction_kind: "personal_itemized" }],
      total: 5000,
      estimated_tax_savings: 0,
      personal_itemized_total: 5000,
      personal_itemized_value: 0,
      standard_deduction: 16100,
    }} />);
    expect(screen.getByText(/below your \$16,100 standard deduction/i)).toBeInTheDocument();
    expect(screen.getByText(/worth nothing/i)).toBeInTheDocument();
  });

  it("shows business expenses as worth money from the first dollar", () => {
    render(<DeductionsSummaryTable summary={{
      ...base,
      lines: [{ tax_line: "Schedule E — Cleaning", amount: 5000, deduction_kind: "business_expense" }],
      total: 5000,
      estimated_tax_savings: 1420,
      business_total: 5000,
      personal_itemized_value: 0,
      standard_deduction: 16100,
    }} />);
    expect(screen.getByText("$1,420.00")).toBeInTheDocument();
    expect(screen.queryByText(/worth nothing/i)).not.toBeInTheDocument();
  });

  it("separates the two kinds of deduction", () => {
    render(<DeductionsSummaryTable summary={{
      ...base,
      lines: [
        { tax_line: "Schedule E — Cleaning", amount: 3000, deduction_kind: "business_expense" },
        { tax_line: "Schedule A — Medical", amount: 2000, deduction_kind: "personal_itemized" },
      ],
      total: 5000, business_total: 3000, personal_itemized_total: 2000,
      estimated_tax_savings: 852, personal_itemized_value: 0, standard_deduction: 16100,
    }} />);
    expect(screen.getByText(/business expenses/i)).toBeInTheDocument();
    expect(screen.getByText(/personal deductions/i)).toBeInTheDocument();
  });

  it("keeps the empty state", () => {
    render(<DeductionsSummaryTable summary={base} />);
    expect(screen.getByText(/no deductible categories yet/i)).toBeInTheDocument();
  });

  it("explains a suspended business loss at higher incomes without saying it was pointless", () => {
    render(<DeductionsSummaryTable summary={{
      ...base,
      lines: [{ tax_line: "Schedule E — Cleaning", amount: 5000, deduction_kind: "business_expense" }],
      total: 5000,
      estimated_tax_savings: 0,
      business_total: 5000,
      personal_itemized_total: 0,
      personal_itemized_value: null,
      standard_deduction: null,
    }} />);
    expect(screen.getByText(/rental loss/i)).toBeInTheDocument();
    expect(screen.getByText(/carried forward/i)).toBeInTheDocument();
    expect(screen.queryByText(/worth nothing/i)).not.toBeInTheDocument();
  });
  it("subtotals each group, since the explanation quotes those figures", () => {
    render(
      <DeductionsSummaryTable
        summary={{
          ...base,
          lines: [
            { tax_line: "Schedule E — Cleaning", amount: 1240, deduction_kind: "business_expense" },
            { tax_line: "Schedule E — Repairs", amount: 860.5, deduction_kind: "business_expense" },
            { tax_line: "Schedule A — Medical", amount: 2000, deduction_kind: "personal_itemized" },
            { tax_line: "Schedule A — Dental", amount: 1200, deduction_kind: "personal_itemized" },
          ],
          total: 5300.5,
          business_total: 2100.5,
          personal_itemized_total: 3200,
        }}
      />
    );
    expect(screen.getByText("Business total")).toBeInTheDocument();
    expect(screen.getByText("$2,100.50")).toBeInTheDocument();
    expect(screen.getByText("Personal total")).toBeInTheDocument();
    expect(screen.getByText("$3,200.00")).toBeInTheDocument();
  });

  it("does not repeat a single line as its own subtotal", () => {
    render(
      <DeductionsSummaryTable
        summary={{
          ...base,
          lines: [{ tax_line: "Schedule A — Medical", amount: 3200, deduction_kind: "personal_itemized" }],
          total: 3200,
          personal_itemized_total: 3200,
        }}
      />
    );
    expect(screen.queryByText("Personal total")).not.toBeInTheDocument();
  });

  it("points at where deductible categories are actually set", () => {
    render(<DeductionsSummaryTable summary={base} />);
    expect(screen.getByRole("link", { name: /categories/i })).toHaveAttribute(
      "href",
      "/categories"
    );
  });
});
