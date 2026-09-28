import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transaction } from "@/lib/api/transactions";
import { BulkActionBar, snapshotFor, undoBatches } from "./bulk-action-bar";

const txn = (over: Partial<Transaction>): Transaction =>
  ({
    id: "t1", account_id: "a", date: "2026-06-01", amount: -10,
    payee_name: "X", category_id: null, cleared: false,
    ...over,
  }) as Transaction;

const categories = [{ id: "c1", name: "Coffee", groupName: "Personal" }] as never;

function bar(props: Partial<React.ComponentProps<typeof BulkActionBar>> = {}) {
  return render(
    <BulkActionBar
      count={3}
      matchingTotal={3}
      allCategories={categories}
      onApply={vi.fn()}
      onSelectAllMatching={vi.fn()}
      onClear={vi.fn()}
      isPending={false}
      loadingAll={false}
      {...props}
    />,
  );
}

describe("<BulkActionBar />", () => {
  it("stays out of the way when nothing is selected", () => {
    const { container } = bar({ count: 0 });
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many are selected", () => {
    bar({ count: 12 });
    expect(screen.getByText("12 selected")).toBeInTheDocument();
  });

  it("offers the wider selection only when there is more to select", () => {
    bar({ count: 50, matchingTotal: 300 });
    expect(screen.getByText("Select all 300 matching")).toBeInTheDocument();
  });

  it("does not offer it once everything matching is already selected", () => {
    bar({ count: 300, matchingTotal: 300 });
    expect(screen.queryByText(/Select all/)).not.toBeInTheDocument();
  });

  it("names the cap rather than silently selecting fewer than it offered", () => {
    bar({ count: 50, matchingTotal: 5000 });
    expect(screen.getByText("Select 500 of 5000 matching")).toBeInTheDocument();
  });

  it("clears the selection", async () => {
    const onClear = vi.fn();
    bar({ onClear });
    await userEvent.click(screen.getByLabelText("Clear selection"));
    expect(onClear).toHaveBeenCalled();
  });

  it("marks cleared and uncleared as separate, explicit actions", async () => {
    const onApply = vi.fn();
    bar({ onApply });
    await userEvent.click(screen.getByRole("button", { name: /Mark cleared/ }));
    expect(onApply).toHaveBeenCalledWith({ cleared: true });
    await userEvent.click(screen.getByRole("button", { name: /Mark uncleared/ }));
    expect(onApply).toHaveBeenCalledWith({ cleared: false });
  });
});

describe("snapshotFor", () => {
  it("captures each row's own previous values", () => {
    const rows = [
      txn({ id: "t1", category_id: "c1", cleared: true }),
      txn({ id: "t2", category_id: null, cleared: false }),
    ];
    expect(snapshotFor(rows, new Set(["t1", "t2"]))).toEqual([
      { id: "t1", category_id: "c1", cleared: true },
      { id: "t2", category_id: null, cleared: false },
    ]);
  });

  it("refuses to snapshot a selection it cannot see all of", () => {
    // "Select all matching" reaches rows on other pages. Restoring only
    // the visible ones would leave the rest changed and call it undone.
    const rows = [txn({ id: "t1" })];
    expect(snapshotFor(rows, new Set(["t1", "offscreen"]))).toBeNull();
  });
});

describe("undoBatches", () => {
  it("restores rows that were all alike in one call", () => {
    const batches = undoBatches([
      { id: "t1", category_id: null, cleared: false },
      { id: "t2", category_id: null, cleared: false },
      { id: "t3", category_id: null, cleared: false },
    ]);
    expect(batches).toEqual([
      { ids: ["t1", "t2", "t3"], clear_category: true, cleared: false },
    ]);
  });

  it("splits rows that were not alike, rather than picking one value", () => {
    // A bulk categorize over a mixed selection cannot be undone by any
    // single setting -- this is what makes undo honest.
    const batches = undoBatches([
      { id: "t1", category_id: "c1", cleared: false },
      { id: "t2", category_id: null, cleared: false },
      { id: "t3", category_id: "c1", cleared: true },
    ]);
    expect(batches).toHaveLength(3);
    expect(batches).toContainEqual({ ids: ["t1"], category_id: "c1", cleared: false });
    expect(batches).toContainEqual({ ids: ["t2"], clear_category: true, cleared: false });
    expect(batches).toContainEqual({ ids: ["t3"], category_id: "c1", cleared: true });
  });

  it("uses clear_category rather than a null category id", () => {
    // `category_id: null` and "field absent" are the same thing once the
    // payload reaches a model with defaults.
    const [batch] = undoBatches([{ id: "t1", category_id: null, cleared: false }]);
    expect(batch).not.toHaveProperty("category_id");
    expect(batch.clear_category).toBe(true);
  });
});
