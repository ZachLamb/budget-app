import { describe, it, expect } from "vitest";
import {
  isSemiMonthlyPayAnchor,
  lastDayOfCalendarMonth,
  payFrequencyNeedsLastPaydate,
} from "./pay-schedule";

describe("lastDayOfCalendarMonth", () => {
  it("matches calendar length", () => {
    expect(lastDayOfCalendarMonth(2026, 2)).toBe(28);
    expect(lastDayOfCalendarMonth(2024, 2)).toBe(29);
    expect(lastDayOfCalendarMonth(2026, 3)).toBe(31);
  });
});

describe("isSemiMonthlyPayAnchor", () => {
  it("accepts the 15th and month-end dates", () => {
    expect(isSemiMonthlyPayAnchor("2026-03-15")).toBe(true);
    expect(isSemiMonthlyPayAnchor("2026-03-31")).toBe(true);
    expect(isSemiMonthlyPayAnchor("2026-02-28")).toBe(true);
    expect(isSemiMonthlyPayAnchor("2024-02-29")).toBe(true);
  });

  it("accepts the 1st (1-and-15 cadence)", () => {
    expect(isSemiMonthlyPayAnchor("2026-04-01")).toBe(true);
    expect(isSemiMonthlyPayAnchor("2026-12-01")).toBe(true);
  });

  it("rejects other days", () => {
    expect(isSemiMonthlyPayAnchor("2026-03-20")).toBe(false);
    expect(isSemiMonthlyPayAnchor("")).toBe(false);
    expect(isSemiMonthlyPayAnchor("not-a-date")).toBe(false);
  });
});

describe("payFrequencyNeedsLastPaydate", () => {
  it("includes semi-monthly", () => {
    expect(payFrequencyNeedsLastPaydate("semimonthly")).toBe(true);
    expect(payFrequencyNeedsLastPaydate("weekly")).toBe(true);
    expect(payFrequencyNeedsLastPaydate("irregular")).toBe(false);
    expect(payFrequencyNeedsLastPaydate(null)).toBe(false);
  });
});
