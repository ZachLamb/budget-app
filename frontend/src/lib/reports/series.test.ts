import { describe, it, expect } from "vitest";
import { fillMonthGaps, summarizeBalances } from "./series";

const pt = (month: string, income = 0, expenses = 0) => ({
  month,
  income,
  expenses,
  net: income + expenses,
});

describe("fillMonthGaps", () => {
  it("inserts a zero month for every gap so the axis stays linear", () => {
    const filled = fillMonthGaps([pt("2026-03", 0, -1240), pt("2026-05", 0, -860)]);
    expect(filled.map((p) => p.month)).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(filled[1]).toEqual({ month: "2026-04", income: 0, expenses: 0, net: 0 });
  });

  it("crosses a year boundary", () => {
    const filled = fillMonthGaps([pt("2025-11"), pt("2026-02")]);
    expect(filled.map((p) => p.month)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("sorts unordered input and leaves real months untouched", () => {
    const filled = fillMonthGaps([pt("2026-05", 100), pt("2026-04", 50)]);
    expect(filled.map((p) => p.income)).toEqual([50, 100]);
  });

  it("returns nothing for no data", () => {
    expect(fillMonthGaps([])).toEqual([]);
  });
});

describe("summarizeBalances", () => {
  it("reports the swing from first to last point", () => {
    const s = summarizeBalances([
      { date: "2026-03-05", balance: -1500 },
      { date: "2026-07-19", balance: -6000 },
      { date: "2026-09-20", balance: -710.75 },
    ]);
    expect(s).toMatchObject({
      start: -1500,
      end: -710.75,
      low: -6000,
      high: -710.75,
      from: "2026-03-05",
      to: "2026-09-20",
    });
    expect(s!.change).toBeCloseTo(789.25, 2);
  });

  it("has nothing to summarize from a single point", () => {
    expect(summarizeBalances([{ date: "2026-03-05", balance: 10 }])).toBeNull();
    expect(summarizeBalances([])).toBeNull();
  });
});
