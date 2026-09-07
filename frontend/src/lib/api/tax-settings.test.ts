import { describe, it, expect, vi } from "vitest";
import api from "./client";
import { taxSettingsApi } from "./tax-settings";

vi.mock("./client", () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

describe("taxSettingsApi", () => {
  it("coerces Decimal-as-string fields from GET into real numbers", async () => {
    const wireResponse = {
      marginal_federal_rate: "22.00",
      marginal_state_rate: "4.40",
      current_federal_withholding_per_period: "1191.80",
      remaining_pay_periods_this_year: 8,
    };
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: wireResponse });

    const result = await taxSettingsApi.get();

    expect(result.marginal_federal_rate).toBe(22);
    expect(typeof result.marginal_federal_rate).toBe("number");
    expect(result.marginal_state_rate).toBe(4.4);
    expect(result.current_federal_withholding_per_period).toBe(1191.8);
  });

  it("coerces Decimal-as-string fields from PUT into real numbers", async () => {
    const wireResponse = {
      marginal_federal_rate: "22.00",
      marginal_state_rate: null,
      current_federal_withholding_per_period: null,
      remaining_pay_periods_this_year: null,
    };
    (api.put as ReturnType<typeof vi.fn>).mockResolvedValue({ data: wireResponse });

    const result = await taxSettingsApi.update({ marginal_federal_rate: 22 });

    expect(result.marginal_federal_rate).toBe(22);
    expect(result.marginal_state_rate).toBeNull();
  });

  it("preserves null for unset fields", async () => {
    const wireResponse = {
      marginal_federal_rate: null,
      marginal_state_rate: null,
      current_federal_withholding_per_period: null,
      remaining_pay_periods_this_year: null,
    };
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: wireResponse });

    const result = await taxSettingsApi.get();

    expect(result.marginal_federal_rate).toBeNull();
    expect(result.remaining_pay_periods_this_year).toBeNull();
  });
});
