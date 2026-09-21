import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaystubList } from "./paystub-list";
import type { Paystub } from "@/lib/api/tax";

const stub: Paystub = {
  id: "p1",
  pay_date: "2026-06-15",
  gross: 3000, pretax_401k: 0, pretax_hsa: 0, pretax_other: 0,
  federal_withheld: 0, state_withheld: 0, ss_withheld: 0, medicare_withheld: 0,
  gross_ytd: 18000, pretax_401k_ytd: 0, pretax_hsa_ytd: 0, pretax_other_ytd: 0,
  federal_withheld_ytd: 0, state_withheld_ytd: 0, ss_withheld_ytd: 0, medicare_withheld_ytd: 0,
};

describe("PaystubList", () => {
  it("shows pay date, gross, and year-to-date gross per row", () => {
    render(<PaystubList paystubs={[stub]} onDelete={vi.fn()} />);
    expect(screen.getByText("$3,000.00")).toBeInTheDocument();
    expect(screen.getByText("$18,000.00")).toBeInTheDocument();
  });

  it("calls onDelete with the row's id", async () => {
    const onDelete = vi.fn();
    render(<PaystubList paystubs={[stub]} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith("p1");
  });

  it("shows an empty state with no paystubs", () => {
    render(<PaystubList paystubs={[]} onDelete={vi.fn()} />);
    expect(screen.getByText(/no paystubs yet/i)).toBeInTheDocument();
  });
  it("offers a correction so a typo does not cost the other fifteen figures", async () => {
    const onEdit = vi.fn();
    render(<PaystubList paystubs={[stub]} onDelete={vi.fn()} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: /correct paystub/i }));
    expect(onEdit).toHaveBeenCalledWith(stub);
  });

  it("shows no correct button when editing is not wired up", () => {
    render(<PaystubList paystubs={[stub]} onDelete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /correct/i })).not.toBeInTheDocument();
  });
});
