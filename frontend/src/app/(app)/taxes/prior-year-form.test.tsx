import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PriorYearForm } from "./prior-year-form";

describe("PriorYearForm", () => {
  it("does not put a min of 0 on agi or schedule_e_net, since both can be negative", async () => {
    render(<PriorYearForm prior={null} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/adjusted gross income/i)).not.toHaveAttribute("min");

    await userEvent.click(screen.getByLabelText(/rental income, itemized deductions, or losses/i));
    expect(screen.getByLabelText(/rental\/schedule e net/i)).not.toHaveAttribute("min");
  });

  it("keeps the terms only an accountant knows out of the way", () => {
    render(<PriorYearForm prior={null} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/total tax owed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/qbi carryforward/i)).not.toBeInTheDocument();
  });

  it("opens that section when last year's return already used it", () => {
    render(
      <PriorYearForm
        prior={{
          year: 2025, filing_status: "single", agi: 100, taxable_income: null,
          total_tax: null, total_withheld: null, itemized: false,
          itemized_amount: null, schedule_e_net: -4200,
          passive_loss_carryforward: 0, capital_loss_carryforward: 0,
          qbi_carryforward: 0,
        }}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/rental\/schedule e net/i)).toHaveValue(-4200);
  });

  it("says what filling it in actually buys", () => {
    render(<PriorYearForm prior={null} onSave={vi.fn()} />);
    expect(screen.getByText(/underpayment penalty/i)).toBeInTheDocument();
  });

  it("puts a min of 0 on the other amount fields", () => {
    render(<PriorYearForm prior={null} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/total tax owed/i)).toHaveAttribute("min", "0");
    expect(screen.getByLabelText(/total withheld/i)).toHaveAttribute("min", "0");
  });

  it("submits entered values, allowing a negative agi", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PriorYearForm prior={null} onSave={onSave} />);

    await userEvent.type(screen.getByLabelText(/adjusted gross income/i), "-5000");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ agi: -5000 }));
  });
});
