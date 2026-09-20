import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectionCard } from "./projection-card";
import type { ProjectionEnvelope } from "@/lib/api/tax";

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
    status: "unknown" as const, test_used: "none", required_payment: null,
    projected_payment: null, shortfall: null, per_period_to_close: null,
    reason: "Enter last year's total tax.",
  },
  explain: [
    { label: "Wages", amount: 179000, detail: "Year-to-date plus projected." },
    { label: "Taxable income", amount: 162900, detail: "Less your deduction." },
  ],
};

const available: ProjectionEnvelope = {
  year: 2026, available: true, missing: [], remaining_pay_periods: 3, projection,
};

describe("ProjectionCard", () => {
  it("says what is missing instead of showing a number it cannot stand behind", () => {
    render(
      <ProjectionCard
        envelope={{ year: 2026, available: false, missing: ["filing_status", "paystub"], remaining_pay_periods: 0, projection: null }}
      />
    );
    expect(screen.getByText(/how you file/i)).toBeInTheDocument();
    expect(screen.getByText(/a recent paystub/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("shows an amount owed as owed, not as a negative refund", () => {
    render(<ProjectionCard envelope={available} />);
    expect(screen.getByText(/you're on track to owe/i)).toBeInTheDocument();
    expect(screen.getByText("$2,555.10")).toBeInTheDocument();
  });

  it("shows a refund when withholding exceeds the bill", () => {
    render(
      <ProjectionCard
        envelope={{
          ...available,
          projection: { ...projection, total_withheld_projected: 56000, refund_or_amount_due: 3444.9 },
        }}
      />
    );
    expect(screen.getByText(/back as a refund/i)).toBeInTheDocument();
  });

  it("explains a standard deduction in plain language", () => {
    render(<ProjectionCard envelope={available} />);
    expect(screen.getByText(/standard deduction/i)).toBeInTheDocument();
  });

  it("reveals the working when expanded", async () => {
    render(<ProjectionCard envelope={available} />);
    expect(screen.queryByText(/year-to-date plus projected/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /show the work/i }));
    expect(screen.getByText(/year-to-date plus projected/i)).toBeInTheDocument();
  });
});
