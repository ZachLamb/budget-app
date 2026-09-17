import { describe, it, expect } from "vitest";
import { suggestionsForPath, GENERAL_SUGGESTIONS } from "./advisor-suggestions";

describe("suggestionsForPath", () => {
  it("gives payees-specific prompts instead of debt payoff", () => {
    const s = suggestionsForPath("/payees");
    expect(s.some((p) => /payees/i.test(p))).toBe(true);
    expect(s.some((p) => /pay off my debt/i.test(p))).toBe(false);
  });

  it("keeps debt prompts on the plan page, where they belong", () => {
    expect(suggestionsForPath("/plan").some((p) => /pay off my debt/i.test(p))).toBe(true);
  });

  it("falls back to the general set on the dashboard and settings", () => {
    expect(suggestionsForPath("/")).toEqual(GENERAL_SUGGESTIONS);
    expect(suggestionsForPath("/settings")).toEqual(GENERAL_SUGGESTIONS);
  });

  it("falls back rather than throwing on an unknown or empty route", () => {
    expect(suggestionsForPath("/does-not-exist")).toEqual(GENERAL_SUGGESTIONS);
    expect(suggestionsForPath(null)).toEqual(GENERAL_SUGGESTIONS);
    expect(suggestionsForPath("")).toEqual(GENERAL_SUGGESTIONS);
  });

  it("ignores a trailing slash and inherits from the top segment", () => {
    expect(suggestionsForPath("/budget/")).toEqual(suggestionsForPath("/budget"));
    // A nested route should inherit its section's prompts.
    expect(suggestionsForPath("/reports/spending")).toEqual(suggestionsForPath("/reports"));
  });

  it("never returns an empty list for any known route", () => {
    for (const p of ["/", "/budget", "/transactions", "/accounts", "/plan", "/reports",
                     "/recurring", "/categories", "/payees", "/rules", "/deductions", "/settings"]) {
      expect(suggestionsForPath(p).length).toBeGreaterThan(0);
    }
  });
});
