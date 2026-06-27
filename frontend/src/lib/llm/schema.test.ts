import { describe, expect, it } from "vitest";
import { schemaForFeature } from "./schema";

describe("schemaForFeature", () => {
  it("returns a JSON schema for fsa_review", () => {
    const s = schemaForFeature("fsa_review");
    expect(s).toBeDefined();
    expect(s?.type).toBe("object");
  });

  it("returns a JSON schema for categorize_transaction", () => {
    const s = schemaForFeature("categorize_transaction");
    expect(s).toBeDefined();
  });

  it("returns undefined for features without a structured schema", () => {
    expect(schemaForFeature("explain_charge")).toBeUndefined();
  });
});
