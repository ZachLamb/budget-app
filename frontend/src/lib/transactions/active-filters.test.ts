import { describe, it, expect } from "vitest";
import { activeFilterChips, clearFiltersPatch } from "./active-filters";

describe("activeFilterChips", () => {
  it("shows nothing when the list is unfiltered", () => {
    expect(activeFilterChips({ page: 1, page_size: 50 })).toEqual([]);
  });

  it("surfaces the uncategorized filter the dashboard links turn on", () => {
    expect(activeFilterChips({ uncategorized: true })).toEqual([
      { key: "uncategorized", label: "Uncategorized only" },
    ]);
  });

  it("names the payee handed over from the payees list", () => {
    const chips = activeFilterChips({ payee_id: "p1" }, { payeeName: "Blue Bottle" });
    expect(chips).toEqual([{ key: "payee_id", label: "Payee: Blue Bottle" }]);
  });

  it("still says a payee filter is on when the name is not known yet", () => {
    const chips = activeFilterChips({ payee_id: "p1" });
    expect(chips[0].label).toBe("Payee: selected payee");
  });

  it("skips account and category chips when their names are unresolved", () => {
    expect(activeFilterChips({ account_id: "a1", category_id: "c1" })).toEqual([]);
    expect(
      activeFilterChips({ account_id: "a1" }, { accountName: "Checking" }),
    ).toEqual([{ key: "account_id", label: "Account: Checking" }]);
  });

  it("ignores a search of only whitespace", () => {
    expect(activeFilterChips({ search: "   " })).toEqual([]);
    expect(activeFilterChips({ search: " milk " })[0].label).toBe("Search: milk");
  });

  it("lists every active filter together", () => {
    const chips = activeFilterChips(
      { uncategorized: true, payee_id: "p1", date_from: "2026-01-01", date_to: "2026-02-01" },
      { payeeName: "Market" },
    );
    expect(chips.map((c) => c.key)).toEqual([
      "uncategorized",
      "payee_id",
      "date_from",
      "date_to",
    ]);
  });
});

describe("clearFiltersPatch", () => {
  it("names every filter key so none survives being merged over", () => {
    const patch = clearFiltersPatch();
    expect(activeFilterChips({ ...{ search: "x", payee_id: "p", uncategorized: true }, ...patch }))
      .toEqual([]);
    expect(patch.page).toBe(1);
  });

  it("leaves page size alone so the list keeps its current size", () => {
    expect(clearFiltersPatch()).not.toHaveProperty("page_size");
  });
});
