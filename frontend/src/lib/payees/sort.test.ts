import { describe, it, expect } from "vitest";
import { mergeActivity, sortPayees, type PayeeRow } from "./sort";

const row = (over: Partial<PayeeRow>): PayeeRow => ({
  id: over.name ?? "x",
  name: "x",
  transaction_count: 0,
  total_amount: 0,
  last_date: null,
  top_category_id: null,
  top_category_name: null,
  ...over,
});

describe("mergeActivity", () => {
  it("keeps a payee with no activity as a zero row", () => {
    const rows = mergeActivity([{ id: "p1", name: "Unused" }], []);
    expect(rows).toEqual([
      {
        id: "p1",
        name: "Unused",
        transaction_count: 0,
        total_amount: 0,
        last_date: null,
        top_category_id: null,
        top_category_name: null,
      },
    ]);
  });

  it("parses the decimal string the API sends into a number", () => {
    const rows = mergeActivity(
      [{ id: "p1", name: "Market" }],
      [
        {
          payee_id: "p1",
          name: "Market",
          transaction_count: 3,
          total_amount: "-60.50",
          last_date: "2026-07-09",
          top_category_id: "c1",
          top_category_name: "Groceries",
        },
      ],
    );
    expect(rows[0].total_amount).toBe(-60.5);
    expect(rows[0].top_category_name).toBe("Groceries");
  });
});

describe("sortPayees", () => {
  const rows = [
    row({ id: "a", name: "Alpha", total_amount: -10, transaction_count: 1, last_date: "2026-01-01" }),
    row({ id: "b", name: "Bravo", total_amount: -500, transaction_count: 9, last_date: "2026-06-01" }),
    row({ id: "c", name: "Charlie", total_amount: 0, transaction_count: 0, last_date: null }),
  ];

  it("sorts by name by default", () => {
    expect(sortPayees(rows, "name").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the biggest outflow first when sorting by spend", () => {
    expect(sortPayees(rows, "spent").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by how often a payee is used", () => {
    expect(sortPayees(rows, "count").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by recency and pushes never-used payees to the end", () => {
    expect(sortPayees(rows, "recent").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks ties on name so the order does not jitter between renders", () => {
    const tied = [row({ id: "z", name: "Zed" }), row({ id: "a", name: "Ada" })];
    expect(sortPayees(tied, "count").map((r) => r.id)).toEqual(["a", "z"]);
    expect(sortPayees(tied, "recent").map((r) => r.id)).toEqual(["a", "z"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [...rows];
    sortPayees(input, "spent");
    expect(input.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
