import { describe, it, expect, vi } from "vitest";
import api from "./client";
import { deductionsApi } from "./deductions";

vi.mock("./client", () => ({
  default: { get: vi.fn() },
}));

describe("deductionsApi.summary", () => {
  it("requests the summary for the given year", async () => {
    const mockData = { year: 2026, lines: [], total: 0, estimated_tax_savings: null, suggested_withholding_reduction_per_period: null };
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockData });

    const result = await deductionsApi.summary(2026);

    expect(api.get).toHaveBeenCalledWith("/deductions/summary", { params: { year: 2026 } });
    expect(result).toEqual(mockData);
  });

  it("coerces Decimal-as-string fields from the API into real numbers", async () => {
    // FastAPI/pydantic serializes Decimal fields as JSON strings on the wire.
    const wireResponse = {
      year: 2026,
      lines: [{ tax_line: "Schedule E — Cleaning", amount: "1240.00" }],
      total: "1240.00",
      estimated_tax_savings: "327.36",
      suggested_withholding_reduction_per_period: "40.92",
    };
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: wireResponse });

    const result = await deductionsApi.summary(2026);

    expect(result.lines[0].amount).toBe(1240);
    expect(typeof result.lines[0].amount).toBe("number");
    expect(result.total).toBe(1240);
    expect(typeof result.total).toBe("number");
    expect(result.estimated_tax_savings).toBe(327.36);
    expect(typeof result.estimated_tax_savings).toBe("number");
    expect(result.suggested_withholding_reduction_per_period).toBe(40.92);
    expect(typeof result.suggested_withholding_reduction_per_period).toBe("number");
  });

  it("preserves null for optional Decimal fields", async () => {
    const wireResponse = {
      year: 2026,
      lines: [],
      total: "0.00",
      estimated_tax_savings: null,
      suggested_withholding_reduction_per_period: null,
    };
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: wireResponse });

    const result = await deductionsApi.summary(2026);

    expect(result.estimated_tax_savings).toBeNull();
    expect(result.suggested_withholding_reduction_per_period).toBeNull();
  });
});
