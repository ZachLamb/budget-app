/**
 * Feature → tier policy. Each AI feature declares which tiers it's *allowed* to run on,
 * which tier is its *default*, and which tier is the *minimum* it'll work usefully on.
 *
 * Default principle: most-private tier that handles the task. Cloud is upgrade, not default.
 */

import type { Tier } from "./types";

export type FeatureId =
  | "explain_charge"
  | "categorize_transaction"
  | "spending_summary"
  | "anomaly_explanation"
  | "budget_recommendations"
  | "goal_planning"
  | "free_form_qa"
  | "financial_advice";

export interface FeaturePolicy {
  /** Stable identifier — also used as the consent record's `feature` field. */
  id: FeatureId;
  /** Short human label for UI. */
  label: string;
  /** Tiers this feature is allowed to run on. Order does not matter. */
  allowedTiers: Tier[];
  /** Lowest acceptable tier — if no allowed tier of this rank is available, the feature is unavailable. */
  minimumTier: Tier;
  /** Tier preferred when more than one in `allowedTiers` is available. */
  defaultTier: Tier;
  /** True when this feature can require Tier 4 (cloud) opt-in. */
  cloudPossible: boolean;
}

const FEATURES: Record<FeatureId, FeaturePolicy> = {
  explain_charge: {
    id: "explain_charge",
    label: "Explain a charge",
    allowedTiers: [1, 2, 4],
    minimumTier: 1,
    defaultTier: 1,
    cloudPossible: true,
  },
  categorize_transaction: {
    id: "categorize_transaction",
    label: "Categorize transaction",
    // Sensitive — prefer local. Cloud only on explicit user override.
    allowedTiers: [1, 2, 4],
    minimumTier: 1,
    defaultTier: 1,
    cloudPossible: true,
  },
  spending_summary: {
    id: "spending_summary",
    label: "Spending summary",
    allowedTiers: [1, 2, 4],
    minimumTier: 1,
    defaultTier: 1,
    cloudPossible: true,
  },
  anomaly_explanation: {
    id: "anomaly_explanation",
    label: "Anomaly explanation",
    allowedTiers: [1, 2, 4],
    minimumTier: 1,
    defaultTier: 1,
    cloudPossible: true,
  },
  budget_recommendations: {
    id: "budget_recommendations",
    label: "Budget recommendations",
    // Needs reasoning the 3B can't handle reliably — cloud preferred.
    allowedTiers: [4],
    minimumTier: 4,
    defaultTier: 4,
    cloudPossible: true,
  },
  goal_planning: {
    id: "goal_planning",
    label: "Goal planning",
    allowedTiers: [4],
    minimumTier: 4,
    defaultTier: 4,
    cloudPossible: true,
  },
  free_form_qa: {
    id: "free_form_qa",
    label: "Free-form Q&A",
    // Quality bar too high for 3B — cloud only.
    allowedTiers: [4],
    minimumTier: 4,
    defaultTier: 4,
    cloudPossible: true,
  },
  financial_advice: {
    id: "financial_advice",
    label: "Financial advice",
    // Liability — explicit per-call consent on top of cloud opt-in.
    allowedTiers: [4],
    minimumTier: 4,
    defaultTier: 4,
    cloudPossible: true,
  },
};

export function getFeaturePolicy(id: FeatureId): FeaturePolicy {
  return FEATURES[id];
}

export function listFeatures(): FeaturePolicy[] {
  return Object.values(FEATURES);
}
