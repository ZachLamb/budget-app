import { describe, it, expect } from "vitest";
import { spendingEmptyState } from "./spending-empty-state";

describe("spendingEmptyState", () => {
  it("explains the real cause when the window's own transactions are uncategorized", () => {
    const s = spendingEmptyState({ inWindow: 189, total: 189 });
    expect(s.description).toContain("189");
    expect(s.description).toMatch(/categor/i);
    // Must NOT claim there was no spending — that was the misleading part.
    expect(s.description).not.toMatch(/no spending/i);
    expect(s.showCategorizeAction).toBe(true);
  });

  it("does not blame a backlog that sits outside the window", () => {
    const s = spendingEmptyState({ inWindow: 0, total: 1 });
    expect(s.description).toMatch(/^No categorized spending in this window\./);
    expect(s.description).toContain("1 older transaction still needs");
    // Still worth offering the categorize route, just not as the explanation.
    expect(s.showCategorizeAction).toBe(true);
  });

  it("keeps the plain message when there is genuinely nothing", () => {
    const s = spendingEmptyState({ inWindow: 0, total: 0 });
    expect(s.description).toBe("No spending in this window yet.");
    expect(s.showCategorizeAction).toBe(false);
  });

  it("reads correctly for exactly one transaction in the window", () => {
    const s = spendingEmptyState({ inWindow: 1, total: 4 });
    expect(s.description).toContain("1 transaction in this window still needs a category");
  });

  it("uses plural wording above one", () => {
    expect(spendingEmptyState({ inWindow: 2, total: 2 }).description).toContain(
      "2 transactions in this window still need a category",
    );
    expect(spendingEmptyState({ inWindow: 0, total: 3 }).description).toContain(
      "3 older transactions still need",
    );
  });
});
