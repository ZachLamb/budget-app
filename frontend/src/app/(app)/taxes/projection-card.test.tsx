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
  supported_filing_statuses: ["single"],
};

describe("ProjectionCard", () => {
  it("shows no number it cannot stand behind, and points at the steps", () => {
    render(
      <ProjectionCard
        envelope={{ year: 2026, available: false, missing: ["filing_status", "paystub"], remaining_pay_periods: 0, projection: null, supported_filing_statuses: ["single"] }}
      />
    );
    expect(screen.getByText(/finish the steps below/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("warns that the rest of the year is unprojected when pay frequency is unusable", () => {
    render(
      <ProjectionCard
        envelope={{ ...available, missing: ["pay_frequency"], remaining_pay_periods: 0 }}
      />
    );
    expect(screen.getByText(/rest of the year/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /pay schedule/i })).toHaveAttribute("href", "/settings#pay");
  });

  it("does not call a partial-year balance a refund", () => {
    render(
      <ProjectionCard
        envelope={{
          ...available,
          missing: ["pay_frequency"],
          remaining_pay_periods: 0,
          projection: { ...projection, refund_or_amount_due: 6031.25 },
        }}
      />
    );
    expect(screen.getByText(/so far this year/i)).toBeInTheDocument();
    expect(screen.queryByText(/on track to get/i)).not.toBeInTheDocument();
  });

  it("says nothing about pay frequency when the year is fully projected", () => {
    render(<ProjectionCard envelope={available} />);
    expect(screen.queryByText(/rest of the year/i)).not.toBeInTheDocument();
  });

  it("explains an unsupported filing status instead of listing it as missing input", () => {
    render(
      <ProjectionCard
        envelope={{
          year: 2026, available: false, missing: ["unsupported_filing_status"],
          remaining_pay_periods: 0, projection: null,
          supported_filing_statuses: ["single"],
        }}
        filingStatus="married_joint"
      />
    );
    expect(screen.getByText(/married, filing together/i)).toBeInTheDocument();
    expect(screen.getByText(/single filers/i)).toBeInTheDocument();
    // The engine's own words are for whoever adds the rate table, not the user.
    expect(screen.queryByText(/sourced rate table/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/things are needed/i)).not.toBeInTheDocument();
  });

  it("does not call adjusted gross income 'what you earn'", () => {
    render(<ProjectionCard envelope={available} />);
    expect(screen.queryByText(/what you earn/i)).not.toBeInTheDocument();
    expect(screen.getByText(/income counted for tax/i)).toBeInTheDocument();
  });

  it("says what the total tax is made of, since no single form line means it", () => {
    render(<ProjectionCard envelope={available} />);
    expect(
      screen.getByText(/federal, Social Security and Medicare, and Colorado/i)
    ).toBeInTheDocument();
  });

  it("closes the table with the figure the headline quotes", () => {
    render(<ProjectionCard envelope={available} />);
    // -2555.10 on the shared fixture: owed, not refunded.
    expect(screen.getByText(/still to pay when you file/i)).toBeInTheDocument();
    expect(screen.getAllByText("$2,555.10").length).toBeGreaterThan(1);
  });

  it("will not quote a refund or a bill when no withholding was entered", () => {
    render(
      <ProjectionCard
        envelope={{ ...available, missing: ["withholding"] }}
      />
    );
    expect(screen.getByText(/no tax withheld/i)).toBeInTheDocument();
    expect(screen.queryByText(/you're on track to owe/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/still to pay when you file/i)).not.toBeInTheDocument();
    // The tax worked out from the pay figures is still sound, so it stays.
    expect(screen.getByText("$52,555.10")).toBeInTheDocument();
  });

  it("shows an amount owed as owed, not as a negative refund", () => {
    render(<ProjectionCard envelope={available} />);
    expect(screen.getByText(/you're on track to owe/i)).toBeInTheDocument();
    // Headline and the table's closing line, never a negative number.
    expect(screen.getAllByText("$2,555.10")).toHaveLength(2);
    expect(screen.queryByText(/-\$2,555\.10/)).not.toBeInTheDocument();
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
