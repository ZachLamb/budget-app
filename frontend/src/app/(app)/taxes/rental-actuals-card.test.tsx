import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RentalActuals } from "@/lib/api/tax";
import { RentalActualsCard } from "./rental-actuals-card";

const rental = (over: Partial<RentalActuals> = {}): RentalActuals => ({
  gross_rental_income: 12400,
  allowable_expenses: 4100,
  net: 8300,
  through: "2026-09-28",
  has_income_category: true,
  ...over,
});

describe("<RentalActualsCard />", () => {
  it("shows income, expenses and the net", () => {
    render(<RentalActualsCard rental={rental()} />);
    expect(screen.getByText("$12,400.00")).toBeInTheDocument();
    expect(screen.getByText("−$4,100.00")).toBeInTheDocument();
    expect(screen.getByText("$8,300.00")).toBeInTheDocument();
  });

  it("says how far the figures reach", () => {
    // The whole point of not annualising: the reader has to know these
    // are actuals to date, or a low estimate looks like a final answer.
    render(<RentalActualsCard rental={rental()} />);
    expect(screen.getByText(/This covers what you have recorded through/)).toBeInTheDocument();
    expect(screen.getByText("9/28/2026")).toBeInTheDocument();
  });

  it("warns that the estimate will rise, and why nothing is guessed", () => {
    render(<RentalActualsCard rental={rental()} />);
    expect(screen.getByText(/Your estimate will rise as more comes in/)).toBeInTheDocument();
    expect(
      screen.getByText(/rental income rarely arrives evenly/),
    ).toBeInTheDocument();
  });

  it("names a loss as a loss", () => {
    render(
      <RentalActualsCard
        rental={rental({ gross_rental_income: 2000, allowable_expenses: 7000, net: -5000 })}
      />,
    );
    expect(screen.getByText("Net rental loss")).toBeInTheDocument();
  });

  it("distinguishes 'nothing recorded yet' from a net of zero", () => {
    // Showing "$0.00 net" here would read as a finished answer rather
    // than an empty one.
    render(
      <RentalActualsCard
        rental={rental({ gross_rental_income: 0, allowable_expenses: 0, net: 0, through: null })}
      />,
    );
    expect(
      screen.getByText(/nothing has been recorded in them this year yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Net rental income")).not.toBeInTheDocument();
  });

  it("says where the two markers are set", () => {
    render(<RentalActualsCard rental={rental()} />);
    expect(screen.getByRole("link", { name: "Categories" })).toHaveAttribute(
      "href",
      "/categories",
    );
  });
});

describe("a half-finished setup", () => {
  it("names the missing marker rather than showing $0 income", () => {
    // Expenses marked, income not. "Rental income $0.00" beside real
    // expenses reads as a bug, or as a rental that earned nothing.
    render(
      <RentalActualsCard
        rental={rental({
          gross_rental_income: 0,
          allowable_expenses: 2100.5,
          net: -2100.5,
          has_income_category: false,
        })}
      />,
    );
    expect(
      screen.getByText(/No income category is marked as rent yet/),
    ).toBeInTheDocument();
    expect(screen.getByText(/reads as a loss it probably is not/)).toBeInTheDocument();
  });

  it("says nothing once an income category is marked", () => {
    render(<RentalActualsCard rental={rental()} />);
    expect(
      screen.queryByText(/No income category is marked as rent yet/),
    ).not.toBeInTheDocument();
  });
});
