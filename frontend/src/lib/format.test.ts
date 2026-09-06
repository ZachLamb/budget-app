import { describe, it, expect } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  it("renders the same calendar day the string names, regardless of local timezone", () => {
    // Regression: new Date("2026-09-06") parses as UTC midnight, so
    // .toLocaleDateString() in any timezone behind UTC (e.g. US timezones)
    // rendered "9/5/2026" for a transaction actually dated 2026-09-06.
    // formatDate must construct the Date from local year/month/day parts
    // instead, so the displayed day always matches the string.
    const [, month, day] = "2026-09-06".split("-").map(Number);
    const expected = new Date(2026, month - 1, day).toLocaleDateString();
    expect(formatDate("2026-09-06")).toBe(expected);
  });

  it("does not shift the day for a date at the start of a month", () => {
    const expected = new Date(2026, 0, 1).toLocaleDateString();
    expect(formatDate("2026-01-01")).toBe(expected);
  });

  it("passes through custom Intl.DateTimeFormatOptions", () => {
    expect(formatDate("2026-09-06", { month: "short", day: "numeric" })).toBe("Sep 6");
  });
});
