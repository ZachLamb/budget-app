import { describe, it, expect } from "vitest";
import { exportScope, monthRange } from "./export-scope";

const base = {
  month: "2026-08",
  trendMonths: ["2026-03", "2026-09"],
  accountId: "acc-1",
  accountName: "Joint Checking",
};

describe("monthRange", () => {
  it("ends on the real last day of the month", () => {
    expect(monthRange("2026-02")).toEqual({ date_from: "2026-02-01", date_to: "2026-02-28" });
    expect(monthRange("2024-02").date_to).toBe("2024-02-29");
    expect(monthRange("2026-04").date_to).toBe("2026-04-30");
    expect(monthRange("2026-12").date_to).toBe("2026-12-31");
  });
});

describe("exportScope", () => {
  it("exports only the month the spending tab is showing", () => {
    const s = exportScope({ ...base, tab: "spending" });
    expect(s.params).toEqual({ date_from: "2026-08-01", date_to: "2026-08-31" });
    expect(s.filename).toBe("transactions-2026-08.csv");
  });

  it("exports the charted range on the trends tab", () => {
    const s = exportScope({ ...base, tab: "trends" });
    expect(s.params).toEqual({ date_from: "2026-03-01", date_to: "2026-09-30" });
    expect(s.filename).toBe("transactions-2026-03-to-2026-09.csv");
  });

  it("exports the selected account on the balances tab", () => {
    const s = exportScope({ ...base, tab: "balances" });
    expect(s.params).toEqual({ account_id: "acc-1" });
    expect(s.filename).toBe("transactions-joint-checking.csv");
  });

  it("falls back to everything when the tab implies no scope", () => {
    expect(exportScope({ ...base, tab: "imports" })).toMatchObject({
      params: {},
      filename: "transactions.csv",
    });
    expect(exportScope({ ...base, tab: "balances", accountId: "" }).params).toEqual({});
    expect(exportScope({ ...base, tab: "trends", trendMonths: [] }).params).toEqual({});
  });

  it("does not put a raw account name into the filename", () => {
    const s = exportScope({ ...base, tab: "balances", accountName: "Zach's Chase 5%/Savings" });
    expect(s.filename).toBe("transactions-zach-s-chase-5-savings.csv");
  });
});
