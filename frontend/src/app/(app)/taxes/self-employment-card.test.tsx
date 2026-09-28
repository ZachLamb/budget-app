import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SelfEmployment } from "@/lib/api/tax";
import { SelfEmploymentCard } from "./self-employment-card";

const se = (over: Partial<SelfEmployment> = {}): SelfEmployment => ({
  net_profit: 20000,
  net_earnings: 18470,
  social_security: 2290.28,
  medicare: 535.63,
  additional_medicare: 0,
  total: 2825.91,
  deductible_half: 1412.96,
  reason: "The full profit is subject to both parts.",
  ...over,
});

describe("<SelfEmploymentCard />", () => {
  it("leads with what is owed", () => {
    render(<SelfEmploymentCard se={se()} />);
    expect(screen.getByText("$2,825.91")).toBeInTheDocument();
  });

  it("names the thing that surprises people", () => {
    // An employer quietly pays half and it never shows on a paystub.
    render(<SelfEmploymentCard se={se()} />);
    expect(screen.getByText(/both\s+halves of Social Security and Medicare/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing withholds this for you/)).toBeInTheDocument();
  });

  it("shows the working, not just the total", () => {
    render(<SelfEmploymentCard se={se()} />);
    expect(screen.getByText("$18,470.00")).toBeInTheDocument();
    expect(screen.getByText("$2,290.28")).toBeInTheDocument();
    expect(screen.getByText("$535.63")).toBeInTheDocument();
  });

  it("carries the engine's own explanation rather than restating it", () => {
    render(
      <SelfEmploymentCard
        se={se({ reason: "Your wages already reached the Social Security wage base." })}
      />,
    );
    expect(
      screen.getByText("Your wages already reached the Social Security wage base."),
    ).toBeInTheDocument();
  });

  it("hides the additional Medicare line when none is owed", () => {
    render(<SelfEmploymentCard se={se()} />);
    expect(screen.queryByText(/Additional Medicare/)).not.toBeInTheDocument();
  });

  it("shows it when there is some", () => {
    render(<SelfEmploymentCard se={se({ additional_medicare: 26.73 })} />);
    expect(screen.getByText(/Additional Medicare/)).toBeInTheDocument();
    expect(screen.getByText("$26.73")).toBeInTheDocument();
  });

  it("says the deduction is already in the estimate above", () => {
    // Otherwise it reads as a further saving still to come.
    render(<SelfEmploymentCard se={se()} />);
    expect(screen.getByText(/already reflected in the estimate above/)).toBeInTheDocument();
  });
});
