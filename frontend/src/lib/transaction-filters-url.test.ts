import { describe, it, expect } from "vitest";
import {
  parseTransactionFiltersFromSearchParams,
  transactionFiltersToSearchParams,
  clampPage,
} from "./transaction-filters-url";

describe("parseTransactionFiltersFromSearchParams", () => {
  it("parses defaults", () => {
    const f = parseTransactionFiltersFromSearchParams(new URLSearchParams());
    expect(f.page).toBe(1);
    expect(f.page_size).toBe(50);
  });

  it("parses uncategorized flag", () => {
    const f = parseTransactionFiltersFromSearchParams(new URLSearchParams("uncategorized=1"));
    expect(f.uncategorized).toBe(true);
  });

  it("clamps invalid page to 1", () => {
    const f = parseTransactionFiltersFromSearchParams(new URLSearchParams("page=0"));
    expect(f.page).toBe(1);
  });
});

describe("transactionFiltersToSearchParams", () => {
  it("omits default page and page_size", () => {
    const p = transactionFiltersToSearchParams({ page: 1, page_size: 50 });
    expect(p.toString()).toBe("");
  });

  it("round-trips search", () => {
    const p = transactionFiltersToSearchParams({ page: 2, search: "coffee" });
    const f = parseTransactionFiltersFromSearchParams(p);
    expect(f.page).toBe(2);
    expect(f.search).toBe("coffee");
  });
});

describe("clampPage", () => {
  it("clamps to valid range", () => {
    expect(clampPage(5, 3)).toBe(3);
    expect(clampPage(0, 3)).toBe(1);
  });
});

describe("payee_id round trip", () => {
  it("parses a payee handed over from the payees list", () => {
    const f = parseTransactionFiltersFromSearchParams(
      new URLSearchParams("payee_id=p-1"),
    );
    expect(f.payee_id).toBe("p-1");
  });

  it("treats the all sentinel as no payee filter", () => {
    const f = parseTransactionFiltersFromSearchParams(
      new URLSearchParams("payee_id=all"),
    );
    expect(f.payee_id).toBeUndefined();
  });

  it("writes the payee back into the URL so the view survives a refresh", () => {
    const qs = transactionFiltersToSearchParams({ page: 1, payee_id: "p-1" }).toString();
    expect(qs).toBe("payee_id=p-1");
  });
});
