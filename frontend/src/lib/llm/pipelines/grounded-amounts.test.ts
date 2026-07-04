import { describe, expect, it } from "vitest";
import { amountsAreGrounded, collectAmountsCents } from "./grounded-amounts";

describe("grounded amounts", () => {
  const allowed = collectAmountsCents({
    budget: { categories: [{ budgeted: 150, actual: 142.5 }] },
    matches: [{ this_month: 7.75 }],
  });
  it("collects nested numeric leaves as cents", () => {
    expect(allowed.has(775)).toBe(true);
    expect(allowed.has(14250)).toBe(true);
  });
  it("accepts answers whose amounts all appear in facts", () => {
    expect(amountsAreGrounded("You spent $7.75 on fees ($142.50 total).", allowed)).toBe(
      true,
    );
  });
  it("accepts thousands separators", () => {
    const a = collectAmountsCents({ x: 1234.5 });
    expect(amountsAreGrounded("That is $1,234.50.", a)).toBe(true);
  });
  it("rejects invented amounts", () => {
    expect(amountsAreGrounded("You spent about $9.99.", allowed)).toBe(false);
  });
  it("passes vacuously with no dollar amounts", () => {
    expect(amountsAreGrounded("Spending is trending down.", allowed)).toBe(true);
  });
});
