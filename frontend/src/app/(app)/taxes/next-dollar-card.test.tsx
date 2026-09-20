import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextDollarCard } from "./next-dollar-card";

describe("NextDollarCard", () => {
  it("leads with dollars and labels the percentage by the amount it spans", () => {
    render(
      <NextDollarCard
        wages={{ kind: "extra_wages", change_amount: 1000, amount_of_tax: 360.5, blended_rate_percent: 36.05, note: "x" }}
        deferral={{ kind: "extra_pretax_401k", change_amount: 1000, amount_of_tax: -284, blended_rate_percent: -28.4, note: "y" }}
      />
    );
    expect(screen.getByText("$360.50")).toBeInTheDocument();
    expect(screen.getByText("$284.00")).toBeInTheDocument();
    expect(screen.getByText(/across this \$1,000/i)).toBeInTheDocument();
  });

  it("renders nothing rather than guessing when impact is unavailable", () => {
    const { container } = render(<NextDollarCard wages={null} deferral={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
