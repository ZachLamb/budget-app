import { describe, it, expect } from "vitest";
import { getFeaturePolicy, listFeatures } from "./features";

describe("features", () => {
  it("returns a policy for each known feature", () => {
    const ids = listFeatures().map((f) => f.id);
    expect(ids).toContain("explain_charge");
    expect(ids).toContain("financial_advice");
  });

  it("explain_charge defaults to local Tier 1", () => {
    const p = getFeaturePolicy("explain_charge");
    expect(p.defaultTier).toBe(1);
    expect(p.minimumTier).toBe(1);
    expect(p.allowedTiers).toContain(4);
  });

  it("free_form_qa is cloud-only", () => {
    const p = getFeaturePolicy("free_form_qa");
    expect(p.allowedTiers).toEqual([4]);
    expect(p.defaultTier).toBe(4);
  });

  it("every policy declares cloudPossible consistent with allowedTiers", () => {
    for (const p of listFeatures()) {
      const declaresCloud = p.allowedTiers.includes(4);
      expect(p.cloudPossible).toBe(declaresCloud);
    }
  });

  it("defaultTier is always in allowedTiers", () => {
    for (const p of listFeatures()) {
      expect(p.allowedTiers).toContain(p.defaultTier);
    }
  });

  it("minimumTier is the lowest allowed tier", () => {
    for (const p of listFeatures()) {
      const lowest = Math.min(...p.allowedTiers);
      expect(p.minimumTier).toBe(lowest);
    }
  });
});
