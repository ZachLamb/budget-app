import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaystubForm } from "./paystub-form";

describe("PaystubForm", () => {
  it("labels year-to-date fields as what the engine anchors on", () => {
    render(<PaystubForm onAdd={vi.fn()} />);
    expect(
      screen.getByText(/year-to-date \(from the right-hand column of your paystub\)/i)
    ).toBeInTheDocument();
  });

  it("every money input is a non-negative number with cent precision", () => {
    render(<PaystubForm onAdd={vi.fn()} />);
    const grossInput = screen.getByLabelText(/gross pay this check/i);
    expect(grossInput).toHaveAttribute("type", "number");
    expect(grossInput).toHaveAttribute("step", "0.01");
    expect(grossInput).toHaveAttribute("min", "0");
  });

  it("submits pay date and entered values", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<PaystubForm onAdd={onAdd} />);

    await userEvent.type(screen.getByLabelText(/pay date/i), "2026-06-15");
    await userEvent.type(screen.getByLabelText(/^gross pay this check$/i), "3000");
    await userEvent.type(screen.getByLabelText(/^gross pay ytd$/i), "18000");
    await userEvent.click(screen.getByRole("button", { name: /add paystub/i }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        pay_date: "2026-06-15",
        gross: 3000,
        gross_ytd: 18000,
      })
    );
  });
});
