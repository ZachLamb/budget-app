import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TaxSettingsCard } from "./tax-settings-card";

describe("TaxSettingsCard", () => {
  it("calls onSave with the entered rate when the form is submitted", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TaxSettingsCard
        settings={{ marginal_federal_rate: null, marginal_state_rate: null, current_federal_withholding_per_period: null, remaining_pay_periods_this_year: null }}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText(/federal rate/i), { target: { value: "22" } });
    fireEvent.change(screen.getByLabelText(/state rate/i), { target: { value: "4.4" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ marginal_federal_rate: 22, marginal_state_rate: 4.4 })
    );
  });
});
