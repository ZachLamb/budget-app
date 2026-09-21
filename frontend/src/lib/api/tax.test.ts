import { describe, it, expect, vi, beforeEach } from "vitest";
import api from "./client";
import { taxApi } from "./tax";

vi.mock("./client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe("taxApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests the projection for a year", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { year: 2026, available: false, missing: ["paystub"], remaining_pay_periods: 0, projection: null },
    });
    const result = await taxApi.projection(2026);
    expect(api.get).toHaveBeenCalledWith("/tax/projection", { params: { year: 2026 } });
    expect(result.available).toBe(false);
    expect(result.projection).toBeNull();
  });

  it("coerces decimal strings in the projection to numbers", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        year: 2026, available: true, missing: [], remaining_pay_periods: 3,
        projection: {
          agi: "179000.00", magi_for_pal: "179000.00", deduction_taken: "16100.00",
          deduction_kind: "standard", standard_deduction: "16100.00",
          itemized_total: "0.00", taxable_income: "162900.00",
          federal_income_tax: "31694.00", social_security_tax: "11098.00",
          medicare_tax: "2595.50", additional_medicare_tax: "0.00",
          state_tax: "7167.60", total_liability: "52555.10",
          total_withheld_projected: "50000.00", refund_or_amount_due: "-2555.10",
          effective_rate: "29.36", schedule_e_allowed_loss: "0.00",
          schedule_e_suspended_loss: "0.00",
          safe_harbor: {
            status: "not_met", test_used: "90_percent_current",
            required_payment: "47299.59", projected_payment: "50000.00",
            shortfall: "0.00", per_period_to_close: "0.00", reason: "ok",
          },
          explain: [{ label: "Wages", amount: "179000.00", detail: "x" }],
        },
      },
    });

    const result = await taxApi.projection(2026);
    expect(result.projection!.total_liability).toBe(52555.1);
    expect(typeof result.projection!.total_liability).toBe("number");
    expect(result.projection!.refund_or_amount_due).toBe(-2555.1);
    expect(result.projection!.explain[0].amount).toBe(179000);
    expect(result.projection!.safe_harbor.shortfall).toBe(0);
  });

  it("posts an impact request and coerces the dollars", async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        kind: "extra_wages", change_amount: "1000.00",
        amount_of_tax: "360.50", blended_rate_percent: "36.05", note: "x",
      },
    });
    const result = await taxApi.impact({ year: 2026, kind: "extra_wages", amount: 1000 });
    expect(api.post).toHaveBeenCalledWith("/tax/impact", {
      year: 2026, kind: "extra_wages", amount: "1000",
    });
    expect(result.amount_of_tax).toBe(360.5);
  });

  it("returns null for a prior year that has no record", async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { status: 404 } });
    await expect(taxApi.priorYear(2025)).resolves.toBeNull();
  });
});
