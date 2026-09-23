import { describe, it, expect } from "vitest";
import { uncategorizedIncome } from "./uncategorized-income";

describe("uncategorizedIncome", () => {
  it("sums only the money coming in", () => {
    const r = uncategorizedIncome({
      transactions: [{ amount: 5000 }, { amount: -410.25 }, { amount: 120 }],
      total: 3,
    });
    expect(r).toEqual({ amount: 5120, partial: false });
  });

  it("says nothing when the uncategorized rows are all spending", () => {
    expect(uncategorizedIncome({ transactions: [{ amount: -10 }], total: 1 })).toBeNull();
  });

  it("says nothing when there is nothing uncategorized", () => {
    expect(uncategorizedIncome({ transactions: [], total: 0 })).toBeNull();
  });

  it("flags a figure that is only part of the answer", () => {
    const r = uncategorizedIncome({ transactions: [{ amount: 100 }], total: 500 });
    expect(r).toEqual({ amount: 100, partial: true });
  });

  it("has nothing to say before the data arrives", () => {
    expect(uncategorizedIncome(undefined)).toBeNull();
  });
});
