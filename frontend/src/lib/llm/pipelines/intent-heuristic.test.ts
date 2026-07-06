import { describe, expect, it } from "vitest";
import { isSpendLookupQuestion, tryHeuristicIntent } from "./intent-heuristic";

describe("tryHeuristicIntent", () => {
  it("detects add transaction with amount and payee", () => {
    const intent = tryHeuristicIntent("Add a $42.50 transaction at Starbucks");
    expect(intent).toMatchObject({
      action_type: "add_transaction",
      data: { amount: 42.5, payee_name: "Starbucks" },
    });
  });

  it("detects create category", () => {
    const intent = tryHeuristicIntent('Create a new category called "Pet Supplies"');
    expect(intent).toMatchObject({
      action_type: "create_category",
      data: { name: "Pet Supplies" },
    });
  });

  it("returns null for vague questions", () => {
    expect(tryHeuristicIntent("How am I doing?")).toBeNull();
  });
});

describe("isSpendLookupQuestion", () => {
  it("matches spend totals", () => {
    expect(isSpendLookupQuestion("How much did I spend on groceries last month?")).toBe(true);
  });

  it("rejects action requests", () => {
    expect(isSpendLookupQuestion("Add $20 for coffee")).toBe(false);
  });
});
