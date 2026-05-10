import { describe, it, expect } from "vitest";
import { scanPrompt } from "./pii-detect";

describe("scanPrompt — positive matches", () => {
  it("flags a US SSN with dashes", () => {
    const scan = scanPrompt("My ssn is 123-45-6789, please don't share.");
    expect(scan.flags).toContain("ssn");
    expect(scan.matchedText.ssn).toEqual(["123-45-6789"]);
  });

  it("flags a US SSN with spaces", () => {
    const scan = scanPrompt("ssn 123 45 6789");
    expect(scan.flags).toContain("ssn");
  });

  it("flags an email address", () => {
    const scan = scanPrompt("Email me at zach.lamb+budget@gmail.com.");
    expect(scan.flags).toContain("email");
    expect(scan.matchedText.email).toEqual(["zach.lamb+budget@gmail.com"]);
  });

  it("flags a US phone number with multiple formats", () => {
    const scan = scanPrompt(
      "Call (415) 555-1212 or 415.555.1212 or 415 555 1212.",
    );
    expect(scan.flags).toContain("phone");
    expect(scan.matchedText.phone.length).toBeGreaterThanOrEqual(3);
  });

  it("flags a Luhn-valid credit card with spaces", () => {
    // 4111 1111 1111 1111 is a well-known Luhn-valid Visa test number.
    const scan = scanPrompt("Card on file: 4111 1111 1111 1111. Charge it.");
    expect(scan.flags).toContain("credit_card");
  });

  it("flags a Luhn-valid credit card with dashes", () => {
    const scan = scanPrompt("Card 4111-1111-1111-1111 expired");
    expect(scan.flags).toContain("credit_card");
  });

  it("reports multiple flags together", () => {
    const scan = scanPrompt(
      "SSN 123-45-6789 and email me at foo@bar.com — call (415) 555-1212.",
    );
    expect(scan.flags).toEqual(
      expect.arrayContaining(["ssn", "email", "phone"]),
    );
  });

  it("caps matchedText at 5 occurrences per flag", () => {
    const emails = Array.from(
      { length: 8 },
      (_, i) => `user${i}@example.com`,
    ).join(" ");
    const scan = scanPrompt(emails);
    expect(scan.matchedText.email.length).toBe(5);
  });
});

describe("scanPrompt — negative cases (no false positives)", () => {
  it("does not flag a money amount like $4,567.89", () => {
    const scan = scanPrompt("Account balance: $4,567.89 after payment.");
    expect(scan.flags).toEqual([]);
  });

  it("does not flag a date like 12-25-2026", () => {
    const scan = scanPrompt("Charge posted on 12-25-2026 for the holiday.");
    expect(scan.flags).toEqual([]);
  });

  it("does not flag an order id like 8675309", () => {
    const scan = scanPrompt("Order id 8675309 was refunded.");
    expect(scan.flags).toEqual([]);
  });

  it("does not flag an invalid (non-Luhn) 16-digit string", () => {
    // Sequential digits — not a valid Luhn checksum.
    const scan = scanPrompt("Reference 1234-5678-9012-3456 from the bank.");
    expect(scan.flags).not.toContain("credit_card");
  });

  it("does not flag SSNs with leading zero block (000-XX-XXXX)", () => {
    const scan = scanPrompt("Test fixture id: 000-12-3456 not real.");
    expect(scan.flags).not.toContain("ssn");
  });

  it("does not flag a bare 9-digit string as SSN", () => {
    const scan = scanPrompt("Confirmation number 123456789 issued.");
    expect(scan.flags).not.toContain("ssn");
  });

  it("does not flag an empty or whitespace prompt", () => {
    expect(scanPrompt("").flags).toEqual([]);
    expect(scanPrompt("   \n\t").flags).toEqual([]);
  });

  it("does not flag a partial digit string like 415-555", () => {
    const scan = scanPrompt("Internal ref 415-555 needs review.");
    expect(scan.flags).toEqual([]);
  });
});
