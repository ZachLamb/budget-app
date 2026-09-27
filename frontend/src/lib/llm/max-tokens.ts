import type { FeatureId } from "./features";

/** Per-feature output caps — smaller limits reduce on-device latency. */
const MAX_TOKENS: Partial<Record<FeatureId, number>> = {
  explain_charge: 200,
  categorize_transaction: 768,
  fsa_review: 1024,
  spending_summary: 512,
  anomaly_explanation: 400,
  budget_recommendations: 1024,
  goal_planning: 512,
  free_form_qa: 1024,
  financial_advice: 1024,
  debt_rate_suggestions: 768,
  // Both budgets carry a reasoning model's thinking as well as its answer:
  // the thinking alone ran to ~2,000 tokens on a one-page paystub, and a
  // budget that only covers the answer returns nothing at all.
  prior_year_extract: 8192,
  paystub_extract: 8192,
  w2_extract: 8192,
};

export function maxTokensFor(feature: FeatureId, override?: number): number {
  if (override != null) return override;
  return MAX_TOKENS[feature] ?? 1024;
}
