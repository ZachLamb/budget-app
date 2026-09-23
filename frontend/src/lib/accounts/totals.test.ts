import { describe, it, expect } from "vitest";
import { groupTotal, isDebt, netWorth } from "./totals";

describe("isDebt", () => {
  it("counts credit cards and loans as debt, nothing else", () => {
    expect(isDebt("credit")).toBe(true);
    expect(isDebt("loan")).toBe(true);
    expect(isDebt("checking")).toBe(false);
    expect(isDebt("property")).toBe(false);
  });
});

describe("groupTotal", () => {
  it("adds a group's balances", () => {
    expect(groupTotal([{ account_type: "checking", balance: 100 }, { account_type: "checking", balance: 25.5 }]))
      .toBe(125.5);
  });

  it("handles the decimal strings the API sends", () => {
    expect(groupTotal([{ account_type: "savings", balance: "1000.25" }])).toBe(1000.25);
  });

  it("is zero for an empty group", () => {
    expect(groupTotal([])).toBe(0);
  });
});

describe("netWorth", () => {
  it("subtracts what is owed from what is held", () => {
    expect(
      netWorth([
        { account_type: "checking", balance: 2000 },
        { account_type: "savings", balance: 500 },
        { account_type: "credit", balance: -1200 },
      ]),
    ).toEqual({ assets: 2500, debts: 1200, net: 1300 });
  });

  it("reads debt as owed whichever sign it is stored in", () => {
    const negative = netWorth([{ account_type: "loan", balance: -5000 }]);
    const positive = netWorth([{ account_type: "loan", balance: 5000 }]);
    expect(negative).toEqual(positive);
    expect(negative.debts).toBe(5000);
  });

  it("keeps an overdrawn checking account as a negative asset, not a debt", () => {
    expect(netWorth([{ account_type: "checking", balance: -710.75 }])).toEqual({
      assets: -710.75,
      debts: 0,
      net: -710.75,
    });
  });

  it("skips a balance that is not a number rather than poisoning the total with NaN", () => {
    expect(netWorth([{ account_type: "checking", balance: 100 }, { account_type: "checking", balance: "oops" }]))
      .toEqual({ assets: 100, debts: 0, net: 100 });
  });

  it("is all zeroes with no accounts", () => {
    expect(netWorth([])).toEqual({ assets: 0, debts: 0, net: 0 });
  });
});
