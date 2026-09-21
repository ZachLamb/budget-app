import { describe, it, expect } from "vitest";
import { spendingEmptyState } from "./spending-empty-state";

describe("spendingEmptyState", () => {
  it("explains the real cause when transactions are uncategorized", () => {
    const s = spendingEmptyState(189);
    expect(s.description).toContain("189");
    expect(s.description).toMatch(/categoriz/i);
    // Must NOT claim there was no spending — that was the misleading part.
    expect(s.description).not.toMatch(/no spending/i);
    expect(s.showCategorizeAction).toBe(true);
  });

  it("keeps the plain message when there is genuinely nothing", () => {
    const s = spendingEmptyState(0);
    expect(s.description).toBe("No spending in this window yet.");
    expect(s.showCategorizeAction).toBe(false);
  });

  it("reads correctly for exactly one transaction", () => {
    const s = spendingEmptyState(1);
    expect(s.description).toContain("1 transaction is");
    expect(s.description).not.toContain("transactions are");
  });

  it("uses plural wording above one", () => {
    expect(spendingEmptyState(2).description).toContain("2 transactions are");
  });
});
