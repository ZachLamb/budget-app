import { describe, expect, it } from "vitest";
import { messageMightBeActionIntent } from "./ai-action-intent";

describe("messageMightBeActionIntent", () => {
  it("returns false for short or generic advice", () => {
    expect(messageMightBeActionIntent("")).toBe(false);
    expect(messageMightBeActionIntent("How can I save more?")).toBe(false);
    expect(messageMightBeActionIntent("What is an emergency fund?")).toBe(false);
  });

  it("returns true for money amounts and dates", () => {
    expect(messageMightBeActionIntent("I spent $45 at CVS on 2024-03-01")).toBe(true);
    expect(messageMightBeActionIntent("Charge was £12.50")).toBe(true);
  });

  it("returns true for add/record transaction phrasing", () => {
    expect(messageMightBeActionIntent("Please add a transaction for coffee $5")).toBe(true);
    expect(messageMightBeActionIntent("Log an expense at Target")).toBe(true);
  });

  it("returns true for debt creation phrasing", () => {
    expect(messageMightBeActionIntent("Add a debt for my car loan")).toBe(true);
  });
});
