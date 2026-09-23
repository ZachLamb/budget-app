import { describe, it, expect } from "vitest";
import { canGoForward, shiftMonth, spendingEmptyMonth } from "./month-nav";

const TODAY = new Date(2026, 8, 22); // 22 September 2026

describe("shiftMonth", () => {
  it("steps across a year boundary in both directions", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("canGoForward", () => {
  it("stops at the current month", () => {
    expect(canGoForward("2026-08", TODAY)).toBe(true);
    expect(canGoForward("2026-09", TODAY)).toBe(false);
    expect(canGoForward("2026-10", TODAY)).toBe(false);
  });
});

describe("spendingEmptyMonth", () => {
  it("sends a first-time user to import and categorize, with nowhere to jump", () => {
    const s = spendingEmptyMonth("2026-09", [], TODAY);
    expect(s.title).toBe("No spending recorded yet");
    expect(s.description).toContain("categories");
    expect(s.jumpTo).toBeNull();
  });

  it("says a future month has not happened rather than blaming the data", () => {
    const s = spendingEmptyMonth("2026-11", ["2026-03", "2026-08"], TODAY);
    expect(s.title).toBe("November 2026 hasn't happened yet");
    expect(s.jumpTo).toBe("2026-08");
    expect(s.jumpLabel).toBe("August 2026");
  });

  it("names the most recent month that does have spending", () => {
    const s = spendingEmptyMonth("2026-09", ["2026-03", "2026-08"], TODAY);
    expect(s.title).toBe("No spending in September 2026");
    expect(s.description).toContain("August 2026");
    expect(s.jumpTo).toBe("2026-08");
  });

  it("offers no jump when the month on screen is already the most recent one", () => {
    const s = spendingEmptyMonth("2026-08", ["2026-03", "2026-08"], TODAY);
    expect(s.jumpTo).toBeNull();
    expect(s.description).toContain("uncategorized");
  });

  it("ignores future months when working out where to send you", () => {
    const s = spendingEmptyMonth("2026-09", ["2026-08", "2027-01"], TODAY);
    expect(s.jumpTo).toBe("2026-08");
  });
});
