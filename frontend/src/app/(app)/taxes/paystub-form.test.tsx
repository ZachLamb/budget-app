import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaystubForm } from "./paystub-form";
import type { Paystub } from "@/lib/api/tax";

const stub: Paystub = {
  id: "p1",
  pay_date: "2026-06-15",
  gross: 3000, pretax_401k: 0, pretax_hsa: 0, pretax_other: 0,
  federal_withheld: 400, state_withheld: 100, ss_withheld: 186, medicare_withheld: 43.5,
  gross_ytd: 18000, pretax_401k_ytd: 0, pretax_hsa_ytd: 0, pretax_other_ytd: 0,
  federal_withheld_ytd: 2400, state_withheld_ytd: 600, ss_withheld_ytd: 1116,
  medicare_withheld_ytd: 261,
};

describe("PaystubForm", () => {
  it("explains what the two columns of a paystub are for", () => {
    render(<PaystubForm onAdd={vi.fn()} />);
    expect(screen.getByText(/two columns of numbers/i)).toBeInTheDocument();
  });

  it("every money input is a non-negative number with cent precision", () => {
    render(<PaystubForm onAdd={vi.fn()} />);
    const grossInput = screen.getByLabelText(/gross pay this check/i);
    expect(grossInput).toHaveAttribute("type", "number");
    expect(grossInput).toHaveAttribute("step", "0.01");
    expect(grossInput).toHaveAttribute("min", "0");
  });

  it("asks only for the three figures it cannot work without", () => {
    render(<PaystubForm onAdd={vi.fn()} />);
    expect(screen.getByLabelText(/pay date/i)).toBeRequired();
    expect(screen.getByLabelText(/gross pay this check/i)).toBeRequired();
    expect(screen.getByLabelText(/gross pay ytd/i)).toBeRequired();
    expect(screen.getByLabelText(/federal tax held back this check/i)).not.toBeRequired();
  });

  it("keeps the pre-tax fields out of the way until they apply", async () => {
    render(<PaystubForm onAdd={vi.fn()} />);
    expect(screen.queryByLabelText(/401\(k\) this check/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/401\(k\), HSA, or other pre-tax/i));
    expect(screen.getByLabelText(/401\(k\) this check/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/HSA YTD/i)).toBeInTheDocument();
  });

  it("submits pay date and entered values", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<PaystubForm onAdd={onAdd} />);

    await userEvent.type(screen.getByLabelText(/pay date/i), "2026-06-15");
    await userEvent.type(screen.getByLabelText(/^gross pay this check/i), "3000");
    await userEvent.type(screen.getByLabelText(/^gross pay ytd/i), "18000");
    await userEvent.click(screen.getByRole("button", { name: /add paystub/i }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ pay_date: "2026-06-15", gross: 3000, gross_ytd: 18000 })
    );
  });

  it("will not submit without the figures the projection is built on", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<PaystubForm onAdd={onAdd} />);

    await userEvent.type(screen.getByLabelText(/pay date/i), "2026-06-15");
    await userEvent.click(screen.getByRole("button", { name: /add paystub/i }));

    expect(onAdd).not.toHaveBeenCalled();
  });

  it("prefills every figure when correcting a paystub", () => {
    render(<PaystubForm onAdd={vi.fn()} editing={stub} onCancelEdit={vi.fn()} />);

    expect(screen.getByLabelText(/pay date/i)).toHaveValue("2026-06-15");
    expect(screen.getByLabelText(/^gross pay ytd/i)).toHaveValue(18000);
    expect(screen.getByLabelText(/federal tax held back ytd/i)).toHaveValue(2400);
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });

  it("opens the pre-tax section when the paystub being corrected uses it", () => {
    render(
      <PaystubForm
        onAdd={vi.fn()}
        editing={{ ...stub, pretax_401k: 550, pretax_401k_ytd: 3300 }}
        onCancelEdit={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/401\(k\) ytd/i)).toHaveValue(3300);
  });

  it("offers a way out of an edit", async () => {
    const onCancelEdit = vi.fn();
    render(<PaystubForm onAdd={vi.fn()} editing={stub} onCancelEdit={onCancelEdit} />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancelEdit).toHaveBeenCalled();
  });
});
