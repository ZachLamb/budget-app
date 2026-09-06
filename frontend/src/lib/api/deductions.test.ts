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
});
