import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PriorYearForm } from "./prior-year-form";

describe("PriorYearForm", () => {
  it("does not put a min of 0 on agi or schedule_e_net, since both can be negative", () => {
    render(<PriorYearForm prior={null} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/adjusted gross income/i)).not.toHaveAttribute("min");
    expect(screen.getByLabelText(/rental\/schedule e net/i)).not.toHaveAttribute("min");
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
