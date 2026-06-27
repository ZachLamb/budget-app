import { describe, it, expect } from "vitest";
import { getFeaturePolicy, listFeatures, type FeatureId } from "./features";

const LIGHT: FeatureId[] = [
  "explain_charge",
  "categorize_transaction",
  "spending_summary",
  "anomaly_explanation",
  "fsa_review",
];
const HEAVY: FeatureId[] = [
  "budget_recommendations",
  "goal_planning",
  "free_form_qa",
  "financial_advice",
];

describe("features (on-device only)", () => {
  it("returns a policy for each known feature", () => {
    const ids = listFeatures().map((f) => f.id);
    expect(ids).toContain("explain_charge");
    expect(ids).toContain("financial_advice");
  });

  it("light features allow Tier 1 + 2", () => {
    for (const id of LIGHT) {
      expect(getFeaturePolicy(id).allowedTiers.slice().sort()).toEqual([1, 2]);
    }
  });

  it("heavy features are Nano-only (Tier 1)", () => {
    for (const id of HEAVY) {
      expect(getFeaturePolicy(id).allowedTiers).toEqual([1]);
    }
  });

  it("every feature defaults to and minimally requires Tier 1", () => {
    for (const p of listFeatures()) {
      expect(p.defaultTier).toBe(1);
      expect(p.minimumTier).toBe(1);
    }
  });

  it("each feature carries an enabled kill switch (default on)", () => {
    for (const p of listFeatures()) {
      expect(p.enabled).toBe(true);
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
