import { describe, it, expect, vi } from "vitest";
import api from "./client";
import { categoriesApi } from "./categories";

vi.mock("./client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const wireCategory = {
  id: "cat-1",
  group_id: "grp-1",
  name: "Cleaning",
  sort_order: 0,
  goal_type: "none",
  goal_amount: null,
  goal_target_date: null,
  created_at: "2026-01-01T00:00:00Z",
  deductible: true,
  deduction_pct: "50.00",
  tax_line: "Schedule E",
};

describe("categoriesApi", () => {
  it("coerces deduction_pct from listGroups into a real number", async () => {
    const wireGroup = {
      id: "grp-1",
      household_id: "hh-1",
      name: "Rental",
      sort_order: 0,
      is_income: false,
      created_at: "2026-01-01T00:00:00Z",
      categories: [wireCategory],
    };
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [wireGroup] });

    const result = await categoriesApi.listGroups();

    expect(result[0].categories[0].deduction_pct).toBe(50);
    expect(typeof result[0].categories[0].deduction_pct).toBe("number");
  });

  it("coerces deduction_pct from create/update", async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: wireCategory });
    (api.put as ReturnType<typeof vi.fn>).mockResolvedValue({ data: wireCategory });

    const created = await categoriesApi.create({ group_id: "grp-1", name: "Cleaning" });
    const updated = await categoriesApi.update("cat-1", { deduction_pct: 50 });

    expect(created.deduction_pct).toBe(50);
    expect(updated.deduction_pct).toBe(50);
  });
});
