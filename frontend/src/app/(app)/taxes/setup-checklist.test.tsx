import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SetupChecklist, buildSteps } from "./setup-checklist";

describe("buildSteps", () => {
  it("marks a step done only when nothing about it is missing", () => {
    const steps = buildSteps({
      missing: ["paystub", "pay_frequency"],
      hasPaystub: false,
      hasPriorYear: false,
    });
    const by = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(by.filing_status.done).toBe(true);
    expect(by.paystub.done).toBe(false);
    expect(by.pay_frequency.done).toBe(false);
  });

  it("treats last year's return as optional", () => {
    const steps = buildSteps({ missing: [], hasPaystub: true, hasPriorYear: false });
    expect(steps.find((s) => s.key === "prior_year_return")?.optional).toBe(true);
  });
});

describe("SetupChecklist", () => {
  const year = 2026;

  it("says how far along you are, counting only the required steps", () => {
    const steps = buildSteps({
      missing: ["paystub", "pay_frequency"],
      hasPaystub: false,
      hasPriorYear: false,
    });
    render(<SetupChecklist steps={steps} year={year} />);
    expect(screen.getByText(/1 of 3 done/i)).toBeInTheDocument();
  });

  it("reassures that nothing is filed or sent", () => {
    const steps = buildSteps({ missing: ["paystub"], hasPaystub: false, hasPriorYear: false });
    render(<SetupChecklist steps={steps} year={year} />);
    expect(screen.getByText(/not filed or sent anywhere|nothing here is filed/i)).toBeInTheDocument();
  });

  it("sends you to Settings for the step that is not on this page", () => {
    const steps = buildSteps({
      missing: ["pay_frequency"],
      hasPaystub: true,
      hasPriorYear: true,
    });
    render(<SetupChecklist steps={steps} year={year} />);
    expect(screen.getByRole("link", { name: /set it in settings/i })).toHaveAttribute(
      "href",
      "/settings"
    );
  });

  it("does not offer a link for a step already done", () => {
    const steps = buildSteps({ missing: [], hasPaystub: true, hasPriorYear: true });
    render(<SetupChecklist steps={steps} year={year} />);
    expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
  });

  it("announces each step's state to a screen reader", () => {
    const steps = buildSteps({ missing: ["paystub"], hasPaystub: false, hasPriorYear: false });
    render(<SetupChecklist steps={steps} year={year} />);
    expect(screen.getAllByText(/\(done\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\(to do\)/).length).toBeGreaterThan(0);
  });
});
