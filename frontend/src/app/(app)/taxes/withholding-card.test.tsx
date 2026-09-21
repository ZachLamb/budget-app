import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WithholdingCard } from "./withholding-card";

const base = {
  status: "unknown" as const, test_used: "none", required_payment: null,
  projected_payment: null, shortfall: null, per_period_to_close: null,
  reason: "Enter last year's total tax to check this.",
};

describe("WithholdingCard", () => {
  it("never claims you are safe when it does not know", () => {
    render(<WithholdingCard safeHarbor={base} remainingPeriods={3} />);
    expect(screen.getByText(/enter last year/i)).toBeInTheDocument();
    expect(screen.queryByText(/on track/i)).not.toBeInTheDocument();
  });

  it("gives a per-paycheck number when short", () => {
    render(
      <WithholdingCard
        safeHarbor={{
          ...base, status: "not_met", test_used: "90_percent_current",
          required_payment: 47299.59, projected_payment: 45000,
          shortfall: 2299.59, per_period_to_close: 766.53,
          reason: "You are $2299.59 short.",
        }}
        remainingPeriods={3}
      />
    );
    expect(screen.getByText("$766.53")).toBeInTheDocument();
  });

  it("qualifies the verdict when the rest of the year is unprojected", () => {
    render(
      <WithholdingCard
        safeHarbor={{ ...base, status: "met", reason: "" }}
        remainingPeriods={0}
        partialYear
      />
    );
    expect(screen.getByText(/pay so far/i)).toBeInTheDocument();
  });

  it("names what the remaining periods are", () => {
    render(
      <WithholdingCard
        safeHarbor={{
          ...base, status: "not_met", shortfall: 900, per_period_to_close: 300,
          reason: "",
        }}
        remainingPeriods={3}
      />
    );
    expect(screen.getByText(/remaining 3 paychecks/i)).toBeInTheDocument();
  });

  it("confirms when the safe harbor is met", () => {
    render(
      <WithholdingCard
        safeHarbor={{ ...base, status: "met", test_used: "90_percent_current", shortfall: 0, per_period_to_close: 0, reason: "You are on track." }}
        remainingPeriods={3}
      />
    );
    expect(screen.getByText(/on track/i)).toBeInTheDocument();
  });
});
