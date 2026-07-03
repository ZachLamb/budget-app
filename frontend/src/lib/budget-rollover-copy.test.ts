import { describe, it, expect } from "vitest";
import { carryoverNote, overspendNote, rtaDeductionNote } from "./budget-rollover-copy";

describe("budget rollover copy", () => {
  it("describes a positive carry-in with the previous month's name", () => {
    expect(carryoverNote(25, "2026-07")).toMatch(/\+\$25(\.00)?.*June/);
  });
  it("is silent when there is nothing carried", () => {
    expect(carryoverNote(0, "2026-07")).toBeNull();
  });
  it("warns on a current-month overspend", () => {
    expect(overspendNote(-40)).toMatch(/Overspent/);
    expect(overspendNote(0)).toBeNull();
    expect(overspendNote(12)).toBeNull();
  });
  it("summarizes prior overspend deducted from Ready to Assign", () => {
    expect(rtaDeductionNote(40)).toMatch(/\$40(\.00)?.*prior overspend/);
    expect(rtaDeductionNote(0)).toBeNull();
  });
});
