import { describe, it, expect } from "vitest";
import { acceptRefinedName, collectAcceptedRefinements } from "./refine-merchant-name";

describe("acceptRefinedName", () => {
  it("accepts a clean extraction from a noisy descriptor", () => {
    expect(acceptRefinedName("SQ *BLUE BOTTLE #4471", "Blue Bottle")).toBe("Blue Bottle");
  });

  it("accepts re-casing of the same words", () => {
    expect(acceptRefinedName("NETFLIX.COM", "Netflix")).toBe("Netflix");
  });

  it("rejects an invented name not present in the source", () => {
    // "Starbucks" shares no tokens with the source → hallucination, rejected.
    expect(acceptRefinedName("SQ *BLUE BOTTLE #4471", "Starbucks")).toBeNull();
  });

  it("rejects a proposal longer than the source", () => {
    expect(acceptRefinedName("Amazon", "Amazon Marketplace Prime")).toBeNull();
  });

  it("rejects empty or punctuation-only proposals", () => {
    expect(acceptRefinedName("Blue Bottle", "   ")).toBeNull();
    expect(acceptRefinedName("Blue Bottle #4", "###")).toBeNull();
  });

  it("rejects when one word is invented even if others match", () => {
    expect(acceptRefinedName("BLUE BOTTLE", "Blue Bottle Cafe")).toBeNull();
  });

  it("allows word reordering as long as all appear in the source", () => {
    expect(acceptRefinedName("BOTTLE BLUE COFFEE", "Blue Bottle")).toBe("Blue Bottle");
  });
});

describe("collectAcceptedRefinements", () => {
  const items = [
    { id: "a", sourceText: "SQ *BLUE BOTTLE #4471", current: "SQ *BLUE BOTTLE #4471" },
    { id: "b", sourceText: "NETFLIX.COM", current: "NETFLIX.COM" },
  ];

  it("keeps only safe, changed proposals keyed by id", () => {
    const out = collectAcceptedRefinements(items, [
      { id: "a", name: "Blue Bottle" },
      { id: "b", name: "Disney Plus" }, // invented → dropped
    ]);
    expect(out).toEqual({ a: "Blue Bottle" });
  });

  it("ignores unchanged proposals", () => {
    const out = collectAcceptedRefinements(
      [{ id: "a", sourceText: "Netflix", current: "Netflix" }],
      [{ id: "a", name: "Netflix" }],
    );
    expect(out).toEqual({});
  });

  it("tolerates malformed model output", () => {
    expect(collectAcceptedRefinements(items, null)).toEqual({});
    expect(collectAcceptedRefinements(items, "not json")).toEqual({});
    expect(collectAcceptedRefinements(items, [{ nope: 1 }, 42])).toEqual({});
  });
});
