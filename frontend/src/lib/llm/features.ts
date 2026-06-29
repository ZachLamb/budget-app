/**
 * Feature → tier policy. Each AI feature declares which tiers it's *allowed* to
 * run on, which tier is its *default*, and which tier is the *minimum* it'll
 * work usefully on.
 *
 * On-device only: Tier 1 (Chrome Nano) is the default and minimum for every
 * feature. Light features may also run on Tier 2 (web-llm); heavy pipelines
 * are Nano-only in v1.
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
  | "financial_advice"
  | "fsa_review"
  | "debt_rate_suggestions";

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
  /** Per-feature kill switch. When false the feature is treated as unavailable. */
  enabled: boolean;
}

const LIGHT_TIERS: Tier[] = [1, 2];
const HEAVY_TIERS: Tier[] = [1];

const FEATURES: Record<FeatureId, FeaturePolicy> = {
  explain_charge: {
    id: "explain_charge",
    label: "Explain a charge",
    allowedTiers: LIGHT_TIERS,
    minimumTier: 1,
    defaultTier: 1,
    enabled: true,
  },
  categorize_transaction: {
    id: "categorize_transaction",
    label: "Categorize transaction",
    allowedTiers: LIGHT_TIERS,
    minimumTier: 1,
    defaultTier: 1,
    enabled: true,
  },
  spending_summary: {
    id: "spending_summary",
    label: "Spending summary",
    allowedTiers: LIGHT_TIERS,
    minimumTier: 1,
    defaultTier: 1,
    enabled: true,
  },
  anomaly_explanation: {
    id: "anomaly_explanation",
    label: "Anomaly explanation",
    allowedTiers: LIGHT_TIERS,
    minimumTier: 1,
    defaultTier: 1,
    enabled: true,
  },
  budget_recommendations: {
    id: "budget_recommendations",
    label: "Budget recommendations",
    allowedTiers: HEAVY_TIERS,
    minimumTier: 1,
    defaultTier: 1,
    enabled: true,
  },
  goal_planning: {
    id: "goal_planning",
    label: "Goal planning",
    allowedTiers: HEAVY_TIERS,
    minimumTier: 1,
    defaultTier: 1,
    enabled: true,
  },
  free_form_qa: {
    id: "free_form_qa",
    label: "Free-form Q&A",
    allowedTiers: HEAVY_TIERS,
    minimumTier: 1,
    defaultTier: 1,
    enabled: true,
  },
  financial_advice: {
    id: "financial_advice",
    label: "Financial advice",
    allowedTiers: HEAVY_TIERS,
    minimumTier: 1,
    defaultTier: 1,
    enabled: true,
  },
  fsa_review: {
    id: "fsa_review",
    label: "FSA reimbursement review",
    allowedTiers: LIGHT_TIERS,
    minimumTier: 1,
    defaultTier: 1,
    enabled: true,
  },
  debt_rate_suggestions: {
    id: "debt_rate_suggestions",
    label: "Debt rate suggestions",
    allowedTiers: HEAVY_TIERS,
    minimumTier: 1,
    defaultTier: 1,
    enabled: true,
  },
};

export function getFeaturePolicy(id: FeatureId): FeaturePolicy {
  return FEATURES[id];
}

export function listFeatures(): FeaturePolicy[] {
  return Object.values(FEATURES);
}
