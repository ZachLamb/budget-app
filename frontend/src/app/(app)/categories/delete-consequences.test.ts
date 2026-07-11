import { describe, it, expect } from "vitest";
import { describeCategoryDelete, describeGroupDelete } from "./delete-consequences";
import type { CategoryGroup, CategoryUsage } from "@/lib/api/categories";

const usage = (over: Partial<CategoryUsage> = {}): CategoryUsage => ({
  transactions: 0, budget_entries: 0, rules: 0, payees: 0, recurring: 0, ...over,
});

const cat = (id: string, name: string) => ({
  id, group_id: "g1", name, sort_order: 0, goal_type: "none",
  goal_amount: null, goal_target_date: null, created_at: "2026-01-01T00:00:00Z",
});

const group = (categories: ReturnType<typeof cat>[]): CategoryGroup => ({
  id: "g1", household_id: "h1", name: "Everyday", sort_order: 0,
  is_income: false, created_at: "2026-01-01T00:00:00Z", categories,
});

describe("describeCategoryDelete", () => {
  it("is generic when usage is unknown", () => {
    const c = describeCategoryDelete(undefined);
    expect(c.blocked).toBe(false);
    expect(c.message).toMatch(/permanently delete/i);
  });
  it("warns how many transactions become uncategorized", () => {
    const c = describeCategoryDelete(usage({ transactions: 12 }));
    expect(c.blocked).toBe(false);
    expect(c.message).toContain("12 transactions will become uncategorized");
  });
  it("uses singular for one transaction", () => {
    expect(describeCategoryDelete(usage({ transactions: 1 })).message)
      .toContain("1 transaction will become uncategorized");
  });
  it("blocks on rules and payee defaults, listing both", () => {
    const c = describeCategoryDelete(usage({ rules: 2, payees: 1 }));
    expect(c.blocked).toBe(true);
    expect(c.message).toContain("2 rules");
    expect(c.message).toContain("1 payee default");
  });
});

describe("describeGroupDelete", () => {
  it("is generic without usage data", () => {
    const c = describeGroupDelete(group([cat("c1", "Groceries")]), undefined);
    expect(c.blocked).toBe(false);
  });
  it("sums transactions across child categories", () => {
    const c = describeGroupDelete(group([cat("c1", "A"), cat("c2", "B")]), {
      c1: usage({ transactions: 3 }), c2: usage({ transactions: 4 }),
    });
    expect(c.blocked).toBe(false);
    expect(c.message).toContain("7 transactions will become uncategorized");
  });
  it("blocks and names the blocked category", () => {
    const c = describeGroupDelete(group([cat("c1", "Groceries")]), {
      c1: usage({ budget_entries: 1 }),
    });
    expect(c.blocked).toBe(true);
    expect(c.message).toContain("'Groceries'");
  });
});
