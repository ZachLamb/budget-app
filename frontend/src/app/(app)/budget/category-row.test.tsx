import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CategoryRow } from "./page";

const base = {
  category_id: "c1", category_name: "Groceries", group_id: "g1",
  assigned: 400, activity: -310,
};

function renderRow(cat: Parameters<typeof CategoryRow>[0]["cat"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CategoryRow cat={cat} month="2026-07" />
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
