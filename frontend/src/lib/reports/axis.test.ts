import { describe, it, expect } from "vitest";
import { compactCurrencyTick } from "./axis";

describe("compactCurrencyTick", () => {
  it("keeps amounts under a thousand exact instead of rounding them to zero", () => {
    expect(compactCurrencyTick(410)).toBe("$410");
    expect(compactCurrencyTick(0)).toBe("$0");
    expect(compactCurrencyTick(999)).toBe("$999");
  });

  it("shortens thousands without flattening distinct values together", () => {
    expect(compactCurrencyTick(1500)).toBe("$1.5k");
    expect(compactCurrencyTick(4500)).toBe("$4.5k");
    expect(compactCurrencyTick(6000)).toBe("$6k");
    expect(compactCurrencyTick(12_000)).toBe("$12k");
  });

  it("keeps the minus sign on negative balances", () => {
    expect(compactCurrencyTick(-5500)).toBe("-$5.5k");
    expect(compactCurrencyTick(-710)).toBe("-$710");
  });

  it("scales past millions", () => {
    expect(compactCurrencyTick(2_400_000)).toBe("$2.4M");
    expect(compactCurrencyTick(3_000_000_000)).toBe("$3B");
  });

  it("returns nothing for a non-finite tick rather than printing NaN", () => {
    expect(compactCurrencyTick(Number.NaN)).toBe("");
    expect(compactCurrencyTick(Number.POSITIVE_INFINITY)).toBe("");
  });
});
