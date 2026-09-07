import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CategoryRow } from "./page";

const base = {
  category_id: "c1", category_name: "Groceries", group_id: "g1",
  assigned: 400, activity: -310,
};

function renderRow(cat: Parameters<typeof CategoryRow>[0]["cat"], isIncome = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CategoryRow cat={cat} month="2026-07" isIncome={isIncome} />
    </QueryClientProvider>,
  );
}

describe("CategoryRow rollover notes", () => {
  it("shows the carry-in note when carryover is positive", () => {
    renderRow({ ...base, carryover: 25, available: 115 });
    expect(screen.getByText(/carried from/i)).toBeInTheDocument();
  });
  it("shows the overspend warning when available is negative", () => {
    renderRow({ ...base, carryover: 0, available: -40 });
    expect(screen.getByText(/will reduce next month/i)).toBeInTheDocument();
  });
  it("stays clean when there is nothing to note", () => {
    renderRow({ ...base, carryover: 0, available: 90 });
    expect(screen.queryByText(/carried from|Overspent/i)).toBeNull();
  });
});

describe("CategoryRow income rows", () => {
  it("renders the assigned amount as read-only text, not an editable button, for income categories", () => {
    // Regression: assigning money to an income category (e.g. Salary) isn't
    // a meaningful envelope-budget action — the backend's Ready-to-Assign
    // math only ever counts income *activity*, never an assigned amount
    // against an income category, so letting a user edit it here silently
    // reduced Ready to Assign with no way to recover it.
    renderRow({ ...base, category_name: "Salary", carryover: 0, available: 0, assigned: 4800 }, true);
    expect(screen.queryByRole("button", { name: /\$4,800\.00/ })).toBeNull();
    expect(screen.getByText("$4,800.00")).toBeInTheDocument();
  });

  it("still renders assigned as an editable button for non-income categories", () => {
    renderRow({ ...base, carryover: 0, available: 90 }, false);
    expect(screen.getByRole("button", { name: /\$400\.00/ })).toBeInTheDocument();
  });
});
